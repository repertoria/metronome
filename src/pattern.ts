// Pattern model: a piece is an ordered list of blocks. Pure logic, no DOM —
// runnable under `node --test` thanks to erasable-only TypeScript syntax.
import type { Source, Tick } from './audio.ts'

/** 0 silent, 1 soft subdivision, 2 normal click, 3 accent */
export type Level = 0 | 1 | 2 | 3
export const SILENT = 0, SOFT = 1, NORMAL = 2, ACCENT = 3

/** Tap cycle: accent → normal → soft → silent → accent */
export const nextLevel = (l: Level): Level => (l === SILENT ? ACCENT : l - 1) as Level

/**
 * keep:  previous tempo, same note speed (so the pulse stays constant across meters)
 * set:   sudden change to the block's target tempo
 * ramp:  gradual change from the previous tempo to the target over the block
 * equiv: metric modulation, "new equivNew = old equivOld"
 */
export type TempoMode = 'keep' | 'set' | 'ramp' | 'equiv'

/**
 * Note values are fractions of a whole note: 1/4 quarter, 3/8 dotted quarter…
 * BAR (0) stands for one whole bar of whichever block the tempo applies to.
 */
export type NoteValue = number
export const BAR: NoteValue = 0

export interface Meter {
  num: number
  den: number
}

/** The real length of a note value, resolving BAR against a meter. */
export const unitIn = (unit: NoteValue, meter: Meter): NoteValue => (unit === BAR ? meter.num / meter.den : unit)

export interface Block {
  id: string
  num: number
  den: number
  bars: number
  /** One level per pulse; see pulsesPerBar(). */
  pattern: Level[]
  /** Whether grouping presets fill the non-grouping pulses with soft clicks. */
  sub: boolean
  tempoMode: TempoMode
  /**
   * Target tempo for set/ramp. Relative blocks store it as a multiple of the
   * piece's start tempo (`rel`) so they follow it; fixed blocks store `bpm`.
   * `unit` is the note value the tempo is shown against in either case.
   */
  fixed: boolean
  rel: number
  bpm: number
  unit: NoteValue
  equivOld: NoteValue
  equivNew: NoteValue
  /** Total plays of the repeated section: 1 = no repeat, 0 = loop forever. */
  repeat: number
  /** How many blocks the repeat covers, ending with this one. */
  repeatSpan: number
}

export interface Piece {
  /** The first block plays at this tempo; relative blocks scale with it. */
  startBpm: number
  startUnit: NoteValue
  blocks: Block[]
  loop: boolean
}

export const MIN_BPM = 20
export const MAX_BPM = 500
export const DEFAULT_QPM = 120
export const NOTE_VALUES: NoteValue[] = [1 / 16, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4, BAR]

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ---- Meter -----------------------------------------------------------------

/** The dot grid is eighth notes for x/2, x/4 and x/8, sixteenths for x/16. */
export const pulseUnit = (den: number): NoteValue => 1 / Math.max(den, 8)
export const pulsesPerNote = (den: number) => Math.max(den, 8) / den
export const pulsesPerBar = (b: Meter) => b.num * pulsesPerNote(b.den)

/** The note value people usually count in for a meter: 6/8 → dotted quarter, 5/8 → eighth. */
export function beatUnit(num: number, den: number): NoteValue {
  const compound = num % 3 === 0 && (den >= 8 || num >= 6)
  return compound ? 3 / den : 1 / den
}

// ---- Tempo -----------------------------------------------------------------
// Internally every tempo is "quarter notes per minute" (qpm).

export const toQpm = (bpm: number, unit: NoteValue) => bpm * unit * 4
export const fromQpm = (qpm: number, unit: NoteValue) => qpm / (unit * 4)

export interface BlockTempo {
  /** qpm at the first pulse */
  start: number
  /** qpm at the end (differs from start only when ramping) */
  end: number
}

const FALLBACK_METER: Meter = { num: 4, den: 4 }

/** The start tempo is counted in the first block's meter (matters for BAR). */
export const startQpm = (p: Piece) => toQpm(p.startBpm, unitIn(p.startUnit, p.blocks[0] ?? FALLBACK_METER))
export const targetQpm = (p: Piece, b: Block) => (b.fixed ? toQpm(b.bpm, unitIn(b.unit, b)) : b.rel * startQpm(p))
/** The set/ramp target in the block's own unit, as shown to the user. */
export const targetBpm = (p: Piece, b: Block) => fromQpm(targetQpm(p, b), unitIn(b.unit, b))

export function setTargetQpm(p: Piece, b: Block, qpm: number) {
  if (b.fixed) b.bpm = Math.round(fromQpm(qpm, unitIn(b.unit, b)) * 10) / 10
  else b.rel = qpm / startQpm(p)
}
export const setTargetBpm = (p: Piece, b: Block, bpm: number) => setTargetQpm(p, b, toQpm(bpm, unitIn(b.unit, b)))

/** Re-read the shown number against a different note value. */
export function setTargetUnit(p: Piece, b: Block, unit: NoteValue) {
  const shown = targetBpm(p, b)
  b.unit = unit
  setTargetBpm(p, b, shown)
}

/** Switch between fixed and relative without changing what plays right now. */
export function setFixed(p: Piece, b: Block, fixed: boolean) {
  const q = targetQpm(p, b)
  b.fixed = fixed
  setTargetQpm(p, b, q)
}

/** The first block always plays at the start tempo. */
export const modeOf = (piece: Piece, i: number): TempoMode => (i === 0 ? 'set' : piece.blocks[i].tempoMode)

export function tempos(piece: Piece): BlockTempo[] {
  let prev = startQpm(piece)
  return piece.blocks.map((b, i) => {
    const target = i === 0 ? prev : targetQpm(piece, b)
    let t: BlockTempo
    switch (modeOf(piece, i)) {
      case 'set': t = { start: target, end: target }; break
      case 'ramp': t = { start: prev, end: target }; break
      case 'equiv': {
        // new equivNew lasts as long as old equivOld
        const q = (prev * unitIn(b.equivNew, b)) / unitIn(b.equivOld, piece.blocks[i - 1])
        t = { start: q, end: q }
        break
      }
      default: t = { start: prev, end: prev }
    }
    prev = t.end
    return t
  })
}

// ---- Grouping presets ------------------------------------------------------

function compositions(n: number): number[][] {
  if (n === 0) return [[]]
  const out: number[][] = []
  for (const p of [2, 3]) if (n >= p) for (const rest of compositions(n - p)) out.push([p, ...rest])
  return out
}

/** Groupings in denominator notes, most common first. e.g. 5/8 → [2,3], [3,2], [1,1,1,1,1]. */
export function groupings(num: number, den: number): number[][] {
  const ones = Array<number>(num).fill(1)
  if (num <= 3) return den >= 8 && num > 1 ? [[num], ones] : [ones]
  const c = compositions(num).sort((a, b) => a.length - b.length).slice(0, 6)
  return den >= 8 ? [...c, ones] : [ones, ...c]
}

export function groupingLabel(groups: number[], den: number): string {
  if (groups.every((g) => g === 1)) return den >= 8 ? 'Every pulse' : 'Beats'
  return groups.join('+')
}

/**
 * Accent on the first group, normal click on each other group, the rest soft
 * (or silent when `sub` is off). In x/4 the quarter notes inside a group stay
 * soft; only the eighth-note offbeats follow `sub`.
 */
export function patternFor(num: number, den: number, groups: number[], sub: boolean): Level[] {
  const ppn = pulsesPerNote(den)
  const fill: Level = sub ? SOFT : SILENT
  const out: Level[] = []
  for (let i = 0; i < num * ppn; i++) out.push(i % ppn === 0 && den <= 4 ? SOFT : fill)
  let pos = 0
  groups.forEach((g, gi) => {
    out[pos * ppn] = gi === 0 ? ACCENT : NORMAL
    pos += g
  })
  return out
}

/** Index into groupings() that produced this block's pattern, or -1 for a hand-edited one. */
export function matchGrouping(b: Block): number {
  const key = b.pattern.join()
  return groupings(b.num, b.den).findIndex((g) => patternFor(b.num, b.den, g, b.sub).join() === key)
}

// ---- Blocks & pieces -------------------------------------------------------

export const uid = () => Math.random().toString(36).slice(2, 10)

export function makeBlock(over: Partial<Block> & { groups?: number[] } = {}): Block {
  const { groups, ...rest } = over
  const num = rest.num ?? 4
  const den = rest.den ?? 4
  const sub = rest.sub ?? den >= 8
  return {
    id: uid(),
    bars: 4,
    tempoMode: 'keep',
    fixed: false,
    rel: 1,
    bpm: 120,
    unit: beatUnit(num, den),
    equivOld: 1 / 4,
    equivNew: 1 / 4,
    repeat: 1,
    repeatSpan: 1,
    pattern: patternFor(num, den, groups ?? groupings(num, den)[0], sub),
    ...rest,
    num,
    den,
    sub,
  }
}

export const defaultPiece = (): Piece => ({
  startBpm: DEFAULT_QPM,
  startUnit: 1 / 4,
  blocks: [makeBlock()],
  loop: true,
})

/** Bring a stored piece up to the current shape. */
export function migratePiece(raw: unknown): Piece {
  const p = raw as Piece
  if (typeof p.startBpm !== 'number') {
    // v1: every block held an absolute tempo and the first block set the start
    p.startBpm = p.blocks[0]?.bpm ?? DEFAULT_QPM
    p.startUnit = p.blocks[0]?.unit ?? 1 / 4
    for (const b of p.blocks) {
      b.fixed = false
      b.rel = toQpm(b.bpm, b.unit) / startQpm(p)
    }
  }
  return p
}

// ---- Flattening repeats ----------------------------------------------------

export interface FlatBar {
  block: number
  /** bar index within the block, 0-based */
  bar: number
}

export interface Plan {
  bars: FlatBar[]
  /** Flat index playback returns to after the last bar, or null to stop. */
  loopStart: number | null
  tempos: BlockTempo[]
}

const MAX_BARS = 20000

export function plan(piece: Piece): Plan {
  const bars: FlatBar[] = []
  const startAt: number[] = []
  const ts = tempos(piece)
  for (let i = 0; i < piece.blocks.length; i++) {
    const b = piece.blocks[i]
    startAt[i] = bars.length
    for (let k = 0; k < b.bars; k++) bars.push({ block: i, bar: k })
    if (b.repeat === 1) continue
    const from = startAt[clamp(i - b.repeatSpan + 1, 0, i)]
    // Loop forever: nothing after this block is ever reached.
    if (b.repeat === 0) return { bars, loopStart: from, tempos: ts }
    const seg = bars.slice(from)
    for (let r = 1; r < b.repeat && bars.length < MAX_BARS; r++) bars.push(...seg)
  }
  return { bars, loopStart: piece.loop ? 0 : null, tempos: ts }
}

/** Index of the first time `block` is played. */
export const firstBarOf = (p: Plan, block: number) => Math.max(0, p.bars.findIndex((b) => b.block === block))

export interface RepeatRange {
  start: number
  end: number
  times: number
  /** nesting depth, 0 = outermost */
  depth: number
}

export function repeatRanges(blocks: Block[]): RepeatRange[] {
  const rs: RepeatRange[] = []
  blocks.forEach((b, i) => {
    if (b.repeat !== 1) rs.push({ start: clamp(i - b.repeatSpan + 1, 0, i), end: i, times: b.repeat, depth: 0 })
  })
  for (const r of rs) {
    r.depth = rs.filter((o) => o !== r && o.start <= r.start && o.end >= r.end && o.end - o.start > r.end - r.start).length
  }
  return rs
}

// ---- Playback --------------------------------------------------------------

export interface PatternPos {
  /** flat bar index */
  bar: number
  block: number
  barInBlock: number
  pulse: number
}

/**
 * Walks the flattened piece one pulse at a time. Re-plans whenever the piece's
 * version changes, so edits apply live while playing.
 */
export class PatternSource implements Source {
  private read: () => { piece: Piece; version: number }
  private planned: Plan | null = null
  private version = -1
  private bar: number
  private pulse = 0

  constructor(read: () => { piece: Piece; version: number }, startBar = 0) {
    this.read = read
    this.bar = startBar
  }

  next(): Tick | null {
    const { piece, version } = this.read()
    if (!this.planned || version !== this.version) {
      this.planned = plan(piece)
      this.version = version
    }
    const p = this.planned
    if (p.bars.length === 0) return null
    for (;;) {
      if (this.bar >= p.bars.length) {
        if (p.loopStart === null) return null
        this.bar = p.loopStart
      }
      if (this.pulse < pulsesPerBar(piece.blocks[p.bars[this.bar].block])) break
      this.pulse = 0
      this.bar++
    }
    const fb = p.bars[this.bar]
    const blk = piece.blocks[fb.block]
    const n = pulsesPerBar(blk)
    const t = p.tempos[fb.block]
    const qpm = t.start + ((t.end - t.start) * (fb.bar * n + this.pulse)) / (blk.bars * n)
    const meta: PatternPos = { bar: this.bar, block: fb.block, barInBlock: fb.bar, pulse: this.pulse }
    const tick: Tick = { dur: (pulseUnit(blk.den) * 240) / Math.max(qpm, 1), level: blk.pattern[this.pulse] ?? SILENT, meta }
    this.pulse++
    return tick
  }
}
