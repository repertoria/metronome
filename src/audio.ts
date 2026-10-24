// Lookahead scheduler (after Chris Wilson's "A Tale of Two Clocks"): a timer
// wakes up every TIMER_MS and schedules every click that falls inside the next
// LOOKAHEAD seconds directly on the audio clock, so timing never depends on
// when the JS timer actually fires.
import type { Level } from './pattern.ts'

export interface Tick {
  /** seconds until the next tick */
  dur: number
  level: Level
  /** passed back to onTick when the click is actually heard */
  meta: unknown
}

export interface Source {
  /** Next tick, or null when the music is over. */
  next(): Tick | null
}

const LOOKAHEAD = 0.12
const TIMER_MS = 25

// Timers in a worker keep running (unthrottled) when the tab is in the background.
const WORKER = `let id=0;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}`

export class Engine {
  onTick: (meta: unknown) => void = () => {}
  onEnd: () => void = () => {}

  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private clicks: AudioBuffer[] = []
  private source: Source | null = null
  private nextTime = 0
  private endTime = Infinity
  private queue: { time: number; meta: unknown }[] = []
  private raf = 0
  private worker: Worker

  constructor() {
    this.worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })))
    this.worker.onmessage = () => this.schedule()
  }

  get playing() {
    return this.source !== null
  }

  /** Must be called from a user gesture the first time (autoplay policy). */
  start(source: Source) {
    this.stop()
    const ctx = this.audio()
    this.out = ctx.createGain()
    this.out.connect(ctx.destination)
    this.source = source
    this.nextTime = ctx.currentTime + 0.05
    this.endTime = Infinity
    this.schedule()
    this.worker.postMessage(TIMER_MS)
    this.raf = requestAnimationFrame(this.frame)
  }

  stop() {
    this.source = null
    this.queue = []
    this.worker.postMessage(0)
    cancelAnimationFrame(this.raf)
    // Disconnecting the output silences clicks already scheduled ahead.
    this.out?.disconnect()
    this.out = null
  }

  private audio(): AudioContext {
    if (!this.ctx) {
      // Safari: play through the ringer/silent switch like a media app.
      const session = (navigator as { audioSession?: { type: string } }).audioSession
      if (session) session.type = 'playback'
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.clicks = makeClicks(this.ctx)
    }
    if (this.ctx.state !== 'running') void this.ctx.resume()
    return this.ctx
  }

  private schedule() {
    const ctx = this.ctx
    if (!ctx || !this.source || !this.out) return
    // If we fell far behind (e.g. device slept), resync rather than burst.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05
    while (this.endTime === Infinity && this.nextTime < ctx.currentTime + LOOKAHEAD) {
      const t = this.source.next()
      if (!t) {
        this.endTime = this.nextTime
        break
      }
      if (t.level > 0) {
        const node = ctx.createBufferSource()
        node.buffer = this.clicks[t.level]
        node.connect(this.out)
        node.start(this.nextTime)
      }
      this.queue.push({ time: this.nextTime, meta: t.meta })
      this.nextTime += t.dur
    }
  }

  /** Audio-clock time of the sound currently coming out of the speaker. */
  private heardTime(ctx: AudioContext): number {
    const ts = ctx.getOutputTimestamp?.()
    if (ts?.contextTime && ts.performanceTime) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)
  }

  private frame = () => {
    const ctx = this.ctx
    if (!ctx || !this.source) return
    const now = this.heardTime(ctx)
    let meta: unknown
    let changed = false
    while (this.queue.length && this.queue[0].time <= now) {
      meta = this.queue.shift()!.meta
      changed = true
    }
    if (changed) this.onTick(meta)
    if (now >= this.endTime) {
      this.stop()
      this.onEnd()
      return
    }
    this.raf = requestAnimationFrame(this.frame)
  }
}

/** Short pitched clicks, indexed by Level (index 0 is never played). */
function makeClicks(ctx: AudioContext): AudioBuffer[] {
  const voices: [freq: number, gain: number, decay: number][] = [
    [0, 0, 1],
    [1100, 0.36, 125],
    [1250, 0.85, 75],
    [1900, 1, 58],
  ]
  // Gentle tanh saturation: louder clicks with peaks still under full scale.
  const DRIVE = 1.6
  const shape = (x: number) => Math.tanh(DRIVE * x) / Math.tanh(DRIVE)
  const sr = ctx.sampleRate
  return voices.map(([freq, gain, decay]) => {
    const len = Math.floor(sr * 0.06)
    const buf = ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) {
      const t = i / sr
      const env = Math.min(1, t * 3000) * Math.exp(-t * decay)
      d[i] = shape(gain * env * (0.75 * Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 2.01 * t)))
    }
    return buf
  })
}
