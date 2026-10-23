import m from 'mithril'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { Capacitor } from '@capacitor/core'
import { Engine, type Source, type Tick } from './audio.ts'
import {
  ACCENT, NORMAL, SOFT, MAX_BPM, MIN_BPM, PatternSource, clamp, firstBarOf, migratePiece, plan, uid,
  type Level, type PatternPos, type Piece,
} from './pattern.ts'
import { kv, requestPersistence } from './storage.ts'

export interface SimpleSettings {
  bpm: number
  beats: number
  /** clicks per beat */
  subdiv: number
  /** level of each beat's main click */
  accents: Level[]
}

export interface SimplePos {
  beat: number
  sub: number
}

export interface SavedPattern {
  id: string
  name: string
  /** ms since epoch of the last edit */
  updated: number
  piece: Piece
}

type Tab = 'simple' | 'pattern'

const KEYS = {
  simple: 'metronome.simple',
  nav: 'metronome.tab',
  library: 'metronome.library',
  /** v1 stored a single piece here */
  legacyPiece: 'metronome.piece',
}

export const state = {
  tab: 'simple' as Tab,
  simple: { bpm: 120, beats: 4, subdiv: 1, accents: [ACCENT, NORMAL, NORMAL, NORMAL] } as SimpleSettings,
  patterns: [] as SavedPattern[],
  /** id of the pattern open in the Pattern tab, null for the library */
  openId: null as string | null,
  /** bumped on every piece edit so a playing PatternSource re-plans */
  version: 0,
  /** id of the block open in the editor */
  editing: null as string | null,
  playing: null as Tab | null,
  simplePos: null as SimplePos | null,
  patternPos: null as PatternPos | null,
}

export const openPattern = () => state.patterns.find((p) => p.id === state.openId)

// ---- Persistence --------------------------------------------------------------

const parse = <T>(raw: string | null): T | null => {
  try {
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Load everything from storage. Call once before mounting. */
export async function init() {
  requestPersistence()
  const [simple, nav, library, legacy] = await Promise.all(
    [KEYS.simple, KEYS.nav, KEYS.library, KEYS.legacyPiece].map((k) => kv.get(k)),
  )
  Object.assign(state.simple, parse<SimpleSettings>(simple))
  const lib = parse<{ patterns: SavedPattern[] }>(library)
  if (lib?.patterns) {
    state.patterns = lib.patterns.filter((p) => p.piece?.blocks?.length)
    for (const p of state.patterns) migratePiece(p.piece)
  } else {
    const old = parse<Piece>(legacy)
    if (old?.blocks?.length) state.patterns = [{ id: uid(), name: 'My pattern', updated: Date.now(), piece: migratePiece(old) }]
  }
  const n = parse<{ tab: Tab; open?: string | null }>(nav)
  if (n?.tab) state.tab = n.tab
  if (n?.open && state.patterns.some((p) => p.id === n.open)) state.openId = n.open
}

const pending = new Set<keyof typeof KEYS>()
let saveTimer = 0

function persist(what: 'simple' | 'nav' | 'library') {
  pending.add(what)
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flush, 300)
}

function flush() {
  clearTimeout(saveTimer)
  for (const what of pending) {
    const value = what === 'simple' ? state.simple
      : what === 'nav' ? { tab: state.tab, open: state.openId }
      : { patterns: state.patterns }
    void kv.set(KEYS[what], JSON.stringify(value))
  }
  pending.clear()
}

// Apps get suspended without warning once backgrounded; write before that.
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
window.addEventListener('pagehide', flush)

// ---- Edits ----------------------------------------------------------------------

export function simpleChanged() {
  const s = state.simple
  s.bpm = clamp(Math.round(s.bpm), MIN_BPM, MAX_BPM)
  while (s.accents.length < s.beats) s.accents.push(NORMAL)
  persist('simple')
}

/** Call after any change to the open pattern's piece. */
export function pieceChanged() {
  const p = openPattern()
  if (p) p.updated = Date.now()
  state.version++
  persist('library')
}

// ---- Library --------------------------------------------------------------------

export function createPattern(name: string, piece: Piece) {
  const p: SavedPattern = { id: uid(), name, updated: Date.now(), piece }
  state.patterns.unshift(p)
  persist('library')
  showPattern(p.id)
}

export function showPattern(id: string | null) {
  stop()
  state.openId = id
  state.editing = null
  state.version++
  persist('nav')
}

export function renamePattern(p: SavedPattern, name: string) {
  p.name = name.trim() || p.name
  p.updated = Date.now()
  persist('library')
}

export function duplicatePattern(p: SavedPattern) {
  const piece: Piece = JSON.parse(JSON.stringify(p.piece)) // plain data; structuredClone needs a newer WebView
  for (const b of piece.blocks) b.id = uid()
  createPattern(`${p.name} copy`, piece)
}

export function deletePattern(p: SavedPattern) {
  if (state.openId === p.id) showPattern(null)
  state.patterns = state.patterns.filter((x) => x !== p)
  persist('library')
}

/** A name like "Pattern 3" that isn't taken yet. */
export function freshName() {
  const taken = new Set(state.patterns.map((p) => p.name))
  let n = state.patterns.length + 1
  while (taken.has(`Pattern ${n}`)) n++
  return `Pattern ${n}`
}

// ---- Playback ---------------------------------------------------------------------

class SimpleSource implements Source {
  private beat = 0
  private sub = 0
  private s: SimpleSettings

  constructor(s: SimpleSettings) {
    this.s = s
  }

  next(): Tick {
    const s = this.s
    if (this.beat >= s.beats) this.beat = 0
    if (this.sub >= s.subdiv) this.sub = 0
    const meta: SimplePos = { beat: this.beat, sub: this.sub }
    const level = this.sub === 0 ? (s.accents[this.beat] ?? NORMAL) : SOFT
    const tick: Tick = { dur: 60 / s.bpm / s.subdiv, level, meta }
    if (++this.sub >= s.subdiv) {
      this.sub = 0
      this.beat = (this.beat + 1) % s.beats
    }
    return tick
  }
}

export const engine = new Engine()

engine.onTick = (meta) => {
  if (state.playing === 'simple') state.simplePos = meta as SimplePos
  else state.patternPos = meta as PatternPos
  m.redraw()
}

engine.onEnd = () => {
  resetPlayback()
  m.redraw()
}

function resetPlayback() {
  state.playing = null
  state.simplePos = null
  state.patternPos = null
  void wakeLock(false)
}

export function play(tab: Tab, fromBlock = 0) {
  if (tab === 'simple') {
    engine.start(new SimpleSource(state.simple))
  } else {
    const pattern = openPattern()
    if (!pattern) return
    const startBar = firstBarOf(plan(pattern.piece), fromBlock)
    engine.start(new PatternSource(() => ({ piece: pattern.piece, version: state.version }), startBar))
  }
  state.playing = tab
  state.simplePos = null
  state.patternPos = null
  void wakeLock(true)
}

export function stop() {
  engine.stop()
  resetPlayback()
}

export function toggle(tab: Tab) {
  if (state.playing === tab) stop()
  else play(tab)
}

/** Tapping the current tab steps back up: block editor → pattern → library. */
export function setTab(tab: Tab) {
  if (tab === state.tab) {
    if (state.editing) state.editing = null
    else if (state.openId) showPattern(null)
    return
  }
  stop()
  state.tab = tab
  persist('nav')
}

/** Android back button: step out one level. Returns false when already at the top. */
export function goBack() {
  if (state.tab !== 'pattern') return false
  setTab(state.editing || state.openId ? 'pattern' : 'simple')
  return true
}

// Keep the screen on while playing. The app uses the native plugin; WebView
// support for the Wake Lock API is patchy.
let lock: { release(): Promise<void> } | null = null
async function wakeLock(on: boolean) {
  if (Capacitor.isNativePlatform()) {
    await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {})
    return
  }
  try {
    if (on && !lock) {
      const wl = (navigator as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
      lock = (await wl?.request('screen')) ?? null
    } else if (!on && lock) {
      const l = lock
      lock = null
      await l.release()
    }
  } catch {
    lock = null
  }
}

document.addEventListener('visibilitychange', () => {
  // The browser drops the wake lock when hidden; take it again on return.
  if (document.visibilityState === 'visible' && state.playing) {
    lock = null
    void wakeLock(true)
  }
})
