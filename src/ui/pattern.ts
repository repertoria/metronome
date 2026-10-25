import m from 'mithril'
import {
  BAR, MAX_BPM, MIN_BPM, NOTE_VALUES, SILENT, SOFT, beatUnit, clamp, fromQpm, groupingLabel, groupings, makeBlock,
  matchGrouping, modeOf, nextLevel, patternFor, pulseUnit, pulsesPerNote, repeatRanges, setFixed,
  setTargetBpm, setTargetQpm, setTargetUnit, targetBpm, tempos, uid, type Block, type BlockTempo, type NoteValue,
  type Piece, type RepeatRange, type TempoMode,
} from '../pattern.ts'
import {
  deletePattern, duplicatePattern, openPattern, pieceChanged, play, renamePattern, showPattern, state, toggle,
  type SavedPattern,
} from '../state.ts'
import {
  dots, icon, note, noteName, plural, segmented, sheet, stepper, tapTempo, tempoChip, toggleSwitch,
} from './common.ts'
import { libraryView } from './library.ts'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
const pct = (b: Block) => `${Math.round(b.rel * 100)}%`

// ---- Plain-language tempo --------------------------------------------------

interface Described {
  /** the tempo in the block's own beat unit, e.g. "♩. = 60" or "♩ = 120 → ♩ = 140" */
  main: m.Children
  /** the pulse tempo when it differs from the beat, e.g. "♪ = 180" */
  pulse: m.Children
  /** how it was derived, e.g. "Pulse unchanged: ♪ = 180" */
  detail: m.Children
}

function describe(piece: Piece, i: number, ts: BlockTempo[]): Described {
  const b = piece.blocks[i]
  const t = ts[i]
  const bu = beatUnit(b.num, b.den)
  const pu = pulseUnit(b.den)
  const mode = modeOf(piece, i)
  const ramp = mode === 'ramp' && !near(t.start, t.end)
  // Lead with bars when that's how this block's tempo was entered.
  const entered = i === 0 ? piece.startUnit : mode === 'set' || mode === 'ramp' ? b.unit : mode === 'equiv' ? b.equivNew : bu
  const shown = entered === BAR ? BAR : bu
  const chip = (q: number, unit = shown) => tempoChip(unit, q, b)
  const main = ramp ? [chip(t.start), m('span.arrow', '→'), chip(t.end)] : chip(t.start)
  const pulse = ramp ? null : shown === BAR ? chip(t.start, bu) : near(bu, pu) ? null : chip(t.start, pu)
  const anchor = b.fixed ? m('span.tag', 'fixed BPM') : m('span.tag', `${pct(b)} of start`)

  let detail: m.Children = 'Start tempo'
  if (i > 0) {
    const prev = ts[i - 1].end
    const prevBeat = beatUnit(piece.blocks[i - 1].num, piece.blocks[i - 1].den)
    switch (mode) {
      case 'keep':
        detail = near(bu, prevBeat) ? 'Same tempo' : ['Same pulse, ', tempoChip(pu, prev)]
        break
      case 'set':
        detail = [near(t.start, prev) ? 'Same tempo' : ['was ', chip(prev)], anchor]
        break
      case 'ramp':
        detail = ramp
          ? [t.end > t.start ? '↗' : '↘', ` over ${plural(b.bars, 'bar')}`, anchor]
          : 'Same tempo'
        break
      case 'equiv':
        detail = ['New ', note(b.equivNew), ' = old ', note(b.equivOld), ' (', tempoChip(b.equivOld, prev, piece.blocks[i - 1]), ')']
        break
    }
  }
  return { main, pulse, detail }
}

function lengthText(piece: Piece): string {
  const bars = piece.blocks.reduce((n, b) => n + b.bars, 0)
  return `${plural(piece.blocks.length, 'block')} · ${plural(bars, 'bar')}`
}

// ---- Shared controls ---------------------------------------------------------

const notePicker = (value: NoteValue, set: (v: NoteValue) => void) =>
  segmented(value, NOTE_VALUES.map((v) => ({ value: v, label: note(v) })), set, '.notes.picker')

let showStartUnits = false
const tapStart = tapTempo((bpm) => {
  const p = openPattern()
  if (!p) return
  p.piece.startBpm = clamp(Math.round(bpm), MIN_BPM, MAX_BPM)
  pieceChanged()
})

/** "♩ = [− 120 +] Tap", with the note value changeable via a picker that folds out. */
function startTempoControl(piece: Piece) {
  return [
    m('.start-row', [
      m('button.note-btn', {
        type: 'button', class: showStartUnits ? 'on' : '', 'aria-expanded': String(showStartUnits),
        'aria-label': `Counting in ${piece.startUnit === BAR ? 'bars' : noteName(piece.startUnit) + ' notes'}. Change note value`,
        onclick: () => (showStartUnits = !showStartUnits),
      }, note(piece.startUnit)),
      m('span.eq', '='),
      stepper({ get: () => piece.startBpm, set: (v) => { piece.startBpm = v; pieceChanged() }, min: MIN_BPM, max: MAX_BPM, label: 'start tempo', suffix: 'BPM' }),
      m('button.tap.small', { type: 'button', onpointerdown: tapStart }, 'Tap'),
    ]),
    showStartUnits && [
      m('p.hint', 'Count the tempo in:'),
      notePicker(piece.startUnit, (v) => { piece.startUnit = v; pieceChanged() }),
    ],
  ]
}

// ---- Pattern screen (block list) -------------------------------------------------

const timeSig = (b: Block) => m('span.ts', [m('span', b.num), m('span', b.den)])

function blockCard(piece: Piece, i: number, ts: BlockTempo[], ranges: RepeatRange[], gutter: number) {
  const b = piece.blocks[i]
  const pos = state.playing === 'pattern' ? state.patternPos : null
  const active = pos?.block === i
  const d = describe(piece, i, ts)
  const ownRepeat = ranges.find((r) => r.end === i)
  return m('.card-row', { key: b.id }, [
    gutter > 0 && m('.gutter', { style: { width: `${gutter * 14}px` } },
      ranges.filter((r) => r.start <= i && i <= r.end).map((r) =>
        m('.br', { class: (r.start === i ? 's ' : '') + (r.end === i ? 'e' : ''), style: { left: `${r.depth * 14}px` } }),
      ),
    ),
    m('button.card', { type: 'button', class: active ? 'active' : '', onclick: () => (state.editing = b.id) }, [
      m('.card-top', [
        m('span.idx', i + 1),
        timeSig(b),
        m('span.bars', plural(b.bars, 'bar')),
        ownRepeat && m('span.rep', ownRepeat.times === 0 ? '∞ loop' : `×${ownRepeat.times}`),
        m('span.card-tempo', d.main),
      ]),
      dots(b.pattern, { small: true, active: active ? pos!.pulse : undefined, flash: state.flash, beatEvery: pulsesPerNote(b.den) }),
      m('.card-detail', active ? `Bar ${pos!.barInBlock + 1} of ${b.bars}` : d.detail),
    ]),
  ])
}

function addBlock(piece: Piece) {
  const last = piece.blocks[piece.blocks.length - 1]
  const b = makeBlock({ num: last.num, den: last.den, sub: last.sub, bars: last.bars, pattern: [...last.pattern] })
  piece.blocks.push(b)
  pieceChanged()
  state.editing = b.id
}

let sheetMode: null | 'menu' | 'rename' = null
let confirmDelete = false
let draftName = ''

function closeSheet() {
  sheetMode = null
  confirmDelete = false
}

function openRename(p: SavedPattern) {
  draftName = p.name
  sheetMode = 'rename'
}

function menuSheet(p: SavedPattern) {
  return sheet(closeSheet, [
    m('h2', p.name),
    m('button.sheet-item', { type: 'button', onclick: () => openRename(p) }, [m('b', 'Rename')]),
    m('button.sheet-item', { type: 'button', onclick: () => { closeSheet(); duplicatePattern(p) } },
      [m('b', 'Duplicate')]),
    m('button.sheet-item.danger', {
      type: 'button',
      onclick: () => {
        if (!confirmDelete) return (confirmDelete = true)
        closeSheet()
        deletePattern(p)
      },
    }, [m('b', confirmDelete ? 'Tap again to delete' : 'Delete'), confirmDelete && m('span', 'This can’t be undone.')]),
    m('button.btn.wide', { type: 'button', onclick: closeSheet }, 'Cancel'),
  ])
}

function renameSheet(p: SavedPattern) {
  return sheet(closeSheet, [
    m('h2', 'Rename pattern'),
    m('form', {
      onsubmit: (e: Event) => {
        e.preventDefault()
        renamePattern(p, draftName)
        closeSheet()
      },
    }, [
      m('input.text', {
        value: draftName, maxlength: 60, enterkeyhint: 'done', 'aria-label': 'Pattern name',
        oninput: (e: Event) => (draftName = (e.target as HTMLInputElement).value),
        oncreate: ({ dom }: { dom: Element }) => {
          ;(dom as HTMLInputElement).focus()
          ;(dom as HTMLInputElement).select()
        },
      }),
      m('.sheet-actions', [
        m('button.btn', { type: 'button', onclick: closeSheet }, 'Cancel'),
        m('button.btn.primary', { type: 'submit' }, 'Save'),
      ]),
    ]),
  ])
}

function patternView(p: SavedPattern) {
  const piece = p.piece
  const ts = tempos(piece)
  const ranges = repeatRanges(piece.blocks)
  const gutter = ranges.length ? Math.max(...ranges.map((r) => r.depth)) + 1 : 0
  return m('.pattern', [
    m('header.bar', [
      m('button.icon-btn', { type: 'button', 'aria-label': 'All patterns', onclick: () => showPattern(null) }, icon.back()),
      m('h1', m('button.title-btn', { type: 'button', title: 'Rename', onclick: () => openRename(p) }, p.name)),
      m('button.icon-btn', { type: 'button', 'aria-label': 'Pattern options', onclick: () => (sheetMode = 'menu') }, icon.more()),
    ]),
    m('section.panel', [
      m('h2', 'Start tempo'),
      startTempoControl(piece),
    ]),
    m('.cards', piece.blocks.map((_, i) => blockCard(piece, i, ts, ranges, gutter))),
    m('button.add', { type: 'button', onclick: () => addBlock(piece) }, [icon.plus(), 'Add block']),
    sheetMode === 'menu' && menuSheet(p),
    sheetMode === 'rename' && renameSheet(p),
  ])
}

// ---- Block editor -------------------------------------------------------------

const MODES: { value: TempoMode; label: string }[] = [
  { value: 'keep', label: 'Same' },
  { value: 'set', label: 'New' },
  { value: 'ramp', label: 'Gradual' },
  { value: 'equiv', label: 'Note = note' },
]

function targetInput(piece: Piece, b: Block, label: string) {
  const changed = () => pieceChanged()
  return [
    m('.field.col', [
      m('span.field-label', label),
      notePicker(b.unit, (v) => { setTargetUnit(piece, b, v); changed() }),
      m('.tempo-eq', [
        m('span.big-note', note(b.unit)),
        m('span.eq', '='),
        stepper({
          get: () => Math.round(targetBpm(piece, b) * 10) / 10,
          set: (v) => { setTargetBpm(piece, b, v); changed() },
          min: MIN_BPM, max: MAX_BPM, label: 'beats per minute', suffix: 'BPM',
        }),
      ]),
    ]),
    toggleSwitch(b.fixed, (v) => { setFixed(piece, b, v); changed() }, 'Fixed BPM'),
  ]
}

function section(title: string, body: m.Children) {
  return m('section.panel', [m('h2', title), body])
}

function editorView(piece: Piece, i: number) {
  const b = piece.blocks[i]
  const ts = tempos(piece)
  const d = describe(piece, i, ts)
  const pos = state.playing === 'pattern' ? state.patternPos : null
  const changed = () => pieceChanged()

  const setMeter = (num: number, den: number) => {
    b.num = num
    b.den = den
    b.pattern = patternFor(num, den, groupings(num, den)[0], b.sub)
    changed()
  }

  const presets = groupings(b.num, b.den)
  const chosen = matchGrouping(b)
  const setSub = (on: boolean) => {
    b.sub = on
    if (chosen >= 0) b.pattern = patternFor(b.num, b.den, presets[chosen], on)
    else b.pattern = b.pattern.map((l) => (on && l === SILENT ? SOFT : !on && l === SOFT ? SILENT : l))
    changed()
  }

  const mode = modeOf(piece, i)
  const setMode = (next: TempoMode) => {
    const prev = ts[i - 1].end
    const bu = beatUnit(b.num, b.den)
    if (next === 'set' || next === 'ramp') {
      // start from what's playing now, so the change is just a nudge away
      b.unit = bu
      setTargetQpm(piece, b, prev)
    } else if (next === 'equiv') {
      const p = piece.blocks[i - 1]
      b.equivOld = beatUnit(p.num, p.den)
      b.equivNew = bu
    }
    b.tempoMode = next
    changed()
  }

  const move = (to: number) => {
    piece.blocks.splice(to, 0, ...piece.blocks.splice(i, 1))
    changed()
  }

  const repeatMode = b.repeat === 1 ? 'off' : b.repeat === 0 ? 'loop' : 'times'
  const span = clamp(b.repeatSpan, 1, i + 1)

  return m('.editor', [
    m('header.bar', [
      m('button.icon-btn', { type: 'button', 'aria-label': 'Back to blocks', onclick: () => (state.editing = null) }, icon.back()),
      m('h1', `Block ${i + 1}`, m('small', ` of ${piece.blocks.length}`)),
      m('button.text-btn', { type: 'button', onclick: () => play('pattern', i) }, 'Play from here'),
    ]),

    m('.result', [
      m('.result-main', [m('span.result-label', 'Plays at'), d.main, d.pulse && m('span.result-pulse', d.pulse)]),
      m('.result-detail', d.detail),
    ]),

    section('Meter', [
      m('.field.col', [
        m('span.field-label', 'Time signature'),
        m('.meter', [
          stepper({ get: () => b.num, set: (v) => setMeter(v, b.den), min: 1, max: 16, label: 'beats per bar' }, '.compact'),
          m('span.slash', '/'),
          segmented(b.den, [2, 4, 8, 16].map((v) => ({ value: v, label: String(v) })), (v) => setMeter(b.num, v)),
        ]),
      ]),
      m('.field', [
        m('span.field-label', 'Length'),
        stepper({ get: () => b.bars, set: (v) => { b.bars = v; changed() }, min: 1, max: 999, label: 'bars', suffix: b.bars === 1 ? 'bar' : 'bars' }),
      ]),
    ]),

    section('Clicks', [
      m('.chips', [
        presets.map((g, gi) =>
          m('button.chip', { type: 'button', class: gi === chosen ? 'on' : '', onclick: () => { b.pattern = patternFor(b.num, b.den, g, b.sub); changed() } },
            groupingLabel(g, b.den)),
        ),
        chosen < 0 && m('span.chip.on.custom', 'Custom'),
      ]),
      toggleSwitch(b.sub, setSub, 'Subdivision clicks'),
      dots(b.pattern, {
        active: pos?.block === i ? pos.pulse : undefined,
        flash: state.flash,
        beatEvery: pulsesPerNote(b.den),
        onTap: (k) => { b.pattern[k] = nextLevel(b.pattern[k]); changed() },
      }),
      m('.legend', [
        m('span', [m('span.dot.l3', m('i')), 'Accent']),
        m('span', [m('span.dot.l2', m('i')), 'Click']),
        m('span', [m('span.dot.l1', m('i')), 'Soft']),
        m('span', [m('span.dot.l0', m('i')), 'Silent']),
      ]),
    ]),

    section('Tempo', i === 0
      ? startTempoControl(piece)
      : [
          segmented(mode, MODES, setMode, '.wrap'),
          mode === 'set' && targetInput(piece, b, 'New tempo'),
          mode === 'ramp' && targetInput(piece, b, 'Target tempo at the end of the block'),
          mode === 'equiv' && [
            m('.field.col', [m('span.field-label', 'New note (this block)'), notePicker(b.equivNew, (v) => { b.equivNew = v; changed() })]),
            m('.field.col', [m('span.field-label', 'equals old note (previous block)'), notePicker(b.equivOld, (v) => { b.equivOld = v; changed() })]),
          ],
        ]),

    section('Repeat', [
      segmented(repeatMode, [
        { value: 'off', label: 'Off' },
        { value: 'times', label: 'Repeat' },
        { value: 'loop', label: 'Loop ∞' },
      ], (v) => {
        b.repeat = v === 'off' ? 1 : v === 'loop' ? 0 : 2
        changed()
      }),
      repeatMode !== 'off' && [
        repeatMode === 'times' && m('.field', [
          m('span.field-label', 'Play'),
          stepper({ get: () => b.repeat, set: (v) => { b.repeat = v; changed() }, min: 2, max: 99, label: 'times', suffix: 'times' }),
        ]),
        i > 0 && m('.field', [
          m('span.field-label', 'Bracket covers'),
          stepper({ get: () => span, set: (v) => { b.repeatSpan = v; changed() }, min: 1, max: i + 1, label: 'blocks', suffix: span === 1 ? 'block' : 'blocks' }),
        ]),
      ],
    ]),

    m('.actions', [
      m('button.btn', { type: 'button', disabled: i === 0, onclick: () => move(i - 1) }, 'Move up'),
      m('button.btn', { type: 'button', disabled: i === piece.blocks.length - 1, onclick: () => move(i + 1) }, 'Move down'),
      m('button.btn', {
        type: 'button',
        onclick: () => {
          const copy: Block = { ...b, id: uid(), pattern: [...b.pattern], repeat: 1, repeatSpan: 1 }
          piece.blocks.splice(i + 1, 0, copy)
          changed()
          state.editing = copy.id
        },
      }, 'Duplicate'),
      m('button.btn.danger', {
        type: 'button', disabled: piece.blocks.length === 1,
        onclick: () => {
          piece.blocks.splice(i, 1)
          changed()
          state.editing = null
        },
      }, 'Delete'),
    ]),
  ])
}

export const PatternView: m.Component = {
  view() {
    const p = openPattern()
    if (!p) return libraryView()
    const i = p.piece.blocks.findIndex((b) => b.id === state.editing)
    return i >= 0 ? editorView(p.piece, i) : patternView(p)
  },
}

export const Transport: m.Component = {
  view() {
    const piece = openPattern()?.piece
    if (!piece) return null
    const playing = state.playing === 'pattern'
    const pos = playing ? state.patternPos : null
    return m('.transport', [
      m('button.loopbtn', {
        type: 'button', class: piece.loop ? 'on' : '', 'aria-pressed': String(piece.loop), title: 'Loop the whole piece',
        onclick: () => { piece.loop = !piece.loop; pieceChanged() },
      }, [icon.loop(), m('span', 'Loop')]),
      m('button.play', { type: 'button', class: playing ? 'on' : '', 'aria-label': playing ? 'Stop' : 'Play', onclick: () => toggle('pattern') },
        playing ? icon.stop() : icon.play()),
      m('.pos', pos
        ? [m('b', `Block ${pos.block + 1} · bar ${pos.barInBlock + 1}/${piece.blocks[pos.block]?.bars ?? '?'}`),
            m('span', describeNow(piece, pos.block, pos.barInBlock))]
        : m('span', lengthText(piece))),
    ])
  },
}

function describeNow(piece: Piece, i: number, bar: number) {
  const b = piece.blocks[i]
  if (!b) return ''
  const t = tempos(piece)[i]
  const q = t.start + ((t.end - t.start) * bar) / b.bars
  return `${b.num}/${b.den} · ${noteName(beatUnit(b.num, b.den))} = ${Math.round(fromQpm(q, beatUnit(b.num, b.den)))}`
}
