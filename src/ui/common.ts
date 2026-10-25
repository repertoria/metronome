import m from 'mithril'
import { BAR, clamp, fromQpm, unitIn, type Level, type Meter, type NoteValue } from '../pattern.ts'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

const NOTE_NAMES: [NoteValue, string][] = [
  [1 / 16, 'sixteenth'], [1 / 8, 'eighth'], [3 / 16, 'dotted eighth'], [1 / 4, 'quarter'],
  [3 / 8, 'dotted quarter'], [1 / 2, 'half'], [3 / 4, 'dotted half'], [1, 'whole'],
]

export const noteName = (unit: NoteValue) => (unit === BAR ? 'bar' : NOTE_NAMES.find(([v]) => near(v, unit))?.[1] ?? 'note')

/** A small music-notation note glyph, drawn as SVG so it renders the same everywhere. */
export function note(unit: NoteValue): m.Vnode {
  if (unit === BAR) return m('span.bar-unit', { role: 'img', 'aria-label': 'bar' }, 'bar')
  const base = [1, 1 / 2, 1 / 4, 1 / 8, 1 / 16].find((b) => near(unit, b) || near(unit, b * 1.5)) ?? 1 / 4
  const dotted = near(unit, base * 1.5)
  const hollow = base >= 1 / 2
  const flags = base === 1 / 8 ? 1 : base === 1 / 16 ? 2 : 0
  const flag = (dy: number) => m('path', { d: `M12.2 ${3 + dy}c.4 4.5 6.6 5.6 4.6 12.2c.4-4-2.2-5.8-4.6-6.4z`, fill: 'currentColor' })
  return m('svg.note', { viewBox: '0 0 22 32', role: 'img', 'aria-label': noteName(unit) }, [
    m('ellipse', {
      cx: 7, cy: 25, rx: 5.4, ry: 3.9, transform: 'rotate(-22 7 25)',
      fill: hollow ? 'none' : 'currentColor', stroke: 'currentColor', 'stroke-width': hollow ? 1.8 : 0,
    }),
    base < 1 && m('rect', { x: 11.4, y: 3, width: 1.6, height: 22, fill: 'currentColor' }),
    flags >= 1 && flag(0),
    flags >= 2 && flag(5.5),
    dotted && m('circle', { cx: 18, cy: 25, r: 1.9, fill: 'currentColor' }),
  ])
}

export const fmt = (n: number) => String(Math.round(n * 10) / 10)
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** "♩. = 60". `meter` resolves BAR to the bar it refers to. */
export const tempoChip = (unit: NoteValue, qpm: number, meter: Meter = { num: 4, den: 4 }) =>
  m('span.tq', [note(unit), m('span', ' = ' + fmt(fromQpm(qpm, unitIn(unit, meter))))])

// ---- Press-and-hold repeat --------------------------------------------------

let holdTimer = 0
const endHold = () => {
  clearTimeout(holdTimer)
  holdTimer = 0
}
window.addEventListener('pointerup', endHold)
window.addEventListener('pointercancel', endHold)

/** Event attrs for a button that fires once on press and repeats (accelerating) while held. */
export function hold(fn: () => void) {
  return {
    onpointerdown: (e: PointerEvent) => {
      e.preventDefault()
      endHold()
      fn()
      let delay = 420
      const again = () => {
        holdTimer = window.setTimeout(() => {
          fn()
          m.redraw()
          delay = Math.max(35, delay * 0.75)
          again()
        }, delay)
      }
      again()
    },
    onpointerleave: endHold,
    oncontextmenu: (e: Event) => e.preventDefault(),
  }
}

// ---- Controls ---------------------------------------------------------------

/** Tap-tempo handler: average the last few taps (within 2.5 s) and report BPM. */
export function tapTempo(set: (bpm: number) => void) {
  let taps: number[] = []
  return () => {
    const now = performance.now()
    taps = taps.filter((t) => now - t < 2500).slice(-5)
    taps.push(now)
    if (taps.length >= 2) set(60000 / ((now - taps[0]) / (taps.length - 1)))
  }
}

/** A bottom sheet over a dimmed backdrop; tapping the backdrop closes it. */
export function sheet(close: () => void, body: m.Children) {
  return m('.sheet-backdrop', { onclick: close },
    m('.sheet', { onclick: (e: Event) => e.stopPropagation() }, [m('.sheet-handle'), body]))
}

export interface StepperOpts {
  get: () => number
  set: (v: number) => void
  min: number
  max: number
  step?: number
  label?: string
  suffix?: string
}

const syncInput = (get: () => number) => ({ dom }: { dom: Element }) => {
  const input = dom as HTMLInputElement
  if (document.activeElement !== input) input.value = fmt(get())
}

export function stepper(o: StepperOpts, cls = '') {
  const step = o.step ?? 1
  const bump = (d: number) => () => o.set(clamp(o.get() + d, o.min, o.max))
  return m('.stepper' + cls, [
    m('button.step', { type: 'button', 'aria-label': `Decrease ${o.label ?? ''}`, disabled: o.get() <= o.min, ...hold(bump(-step)) }, '−'),
    m('label.step-val', [
      m('input', {
        type: 'number', inputmode: 'decimal', min: o.min, max: o.max, 'aria-label': o.label,
        // Set value by hand so playback redraws don't clobber what's being typed.
        oncreate: syncInput(o.get),
        onupdate: syncInput(o.get),
        onfocus: (e: FocusEvent) => (e.target as HTMLInputElement).select(),
        onchange: (e: Event) => {
          const v = parseFloat((e.target as HTMLInputElement).value)
          if (!Number.isNaN(v)) o.set(clamp(v, o.min, o.max))
          ;(e.target as HTMLInputElement).value = fmt(o.get())
        },
        onkeydown: (e: KeyboardEvent & { redraw?: boolean }) => {
          e.redraw = false
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        },
      }),
      o.suffix && m('span.suffix', o.suffix),
    ]),
    m('button.step', { type: 'button', 'aria-label': `Increase ${o.label ?? ''}`, disabled: o.get() >= o.max, ...hold(bump(step)) }, '+'),
  ])
}

export interface SegItem<T> {
  value: T
  label: m.Children
  title?: string
}

export function segmented<T>(value: T, items: SegItem<T>[], set: (v: T) => void, cls = '') {
  return m('.seg' + cls, { role: 'radiogroup' },
    items.map((it) =>
      m('button', {
        type: 'button', role: 'radio', 'aria-checked': String(it.value === value), title: it.title,
        class: it.value === value ? 'on' : '',
        onclick: () => set(it.value),
      }, it.label),
    ),
  )
}

export function toggleSwitch(on: boolean, set: (v: boolean) => void, label: string) {
  return m('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(on), onclick: () => set(!on) }, [
    m('span.switch-label', label),
    m('span.switch-track', { class: on ? 'on' : '' }, m('span.switch-knob')),
  ])
}

const LEVEL_NAMES = ['silent', 'soft', 'click', 'accent']

/**
 * Scale a dot row so it fits on one line. Everything in the row is sized as a
 * multiple of --s, so its natural width is the current width divided by --s.
 */
function fitDots({ dom }: { dom: Element }) {
  const row = dom as HTMLElement
  const first = row.firstElementChild as HTMLElement | null
  const last = row.lastElementChild as HTMLElement | null
  if (!first || !last || !row.clientWidth) return
  const s = parseFloat(row.style.getPropertyValue('--s')) || 1
  const width = last.offsetLeft + last.offsetWidth - first.offsetLeft
  const fit = Math.min(1, Math.floor((row.clientWidth / (width / s)) * 100) / 100)
  if (fit !== s) row.style.setProperty('--s', String(fit))
}
window.addEventListener('resize', () => m.redraw())

/**
 * A row of pulse dots. `beatEvery` adds a little gap every n pulses so x/4
 * eighth-note pairs read as beats.
 */
export function dots(pattern: Level[], opts: { active?: number; flash?: number; onTap?: (i: number) => void; beatEvery?: number; small?: boolean }) {
  const every = opts.beatEvery ?? 1
  return m('.dots', { class: opts.small ? 'small' : '', oncreate: fitDots, onupdate: fitDots },
    pattern.map((lvl, i) =>
      m(opts.onTap ? 'button.dot' : 'span.dot', {
        key: i,
        type: opts.onTap ? 'button' : undefined,
        class: `l${lvl}${i === opts.active ? ` now f${(opts.flash ?? 0) % 2}` : ''}${every > 1 && i > 0 && i % every === 0 ? ' gap' : ''}`,
        'aria-label': opts.onTap ? `Pulse ${i + 1}: ${LEVEL_NAMES[lvl]}` : undefined,
        onclick: opts.onTap ? () => opts.onTap!(i) : undefined,
      }, m('i')),
    ),
  )
}

export const icon = {
  play: () => m('svg.ico', { viewBox: '0 0 24 24' }, m('path', { d: 'M7 4.5v15l13-7.5z', fill: 'currentColor' })),
  stop: () => m('svg.ico', { viewBox: '0 0 24 24' }, m('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2, fill: 'currentColor' })),
  back: () => m('svg.ico', { viewBox: '0 0 24 24' }, m('path', { d: 'M15 5l-7 7 7 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
  loop: () => m('svg.ico', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
    m('path', { d: 'M17 2l3 3-3 3' }), m('path', { d: 'M4 11V9a4 4 0 0 1 4-4h12' }),
    m('path', { d: 'M7 22l-3-3 3-3' }), m('path', { d: 'M20 13v2a4 4 0 0 1-4 4H4' }),
  ]),
  metronome: () => m('svg.ico', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, [
    m('path', { d: 'M9 3h6l3.5 18h-13z' }), m('path', { d: 'M12 16l5-9' }),
  ]),
  blocks: () => m('svg.ico', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linejoin': 'round' }, [
    m('rect', { x: 3, y: 4, width: 18, height: 6, rx: 1.5 }), m('rect', { x: 3, y: 14, width: 18, height: 6, rx: 1.5 }),
  ]),
  more: () => m('svg.ico', { viewBox: '0 0 24 24', fill: 'currentColor' }, [5, 12, 19].map((x) => m('circle', { cx: x, cy: 12, r: 2 }))),
  chevron: () => m('svg.ico.chev', { viewBox: '0 0 24 24' }, m('path', { d: 'M9 5l7 7-7 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
  plus: () => m('svg.ico', { viewBox: '0 0 24 24' }, m('path', { d: 'M12 5v14M5 12h14', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' })),
}
