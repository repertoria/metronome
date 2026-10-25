import m from 'mithril'
import { MAX_BPM, MIN_BPM, clamp, nextLevel } from '../pattern.ts'
import { simpleChanged, state, toggle } from '../state.ts'
import { dots, hold, icon, stepper, tapTempo } from './common.ts'

const MARKINGS: [number, string][] = [
  [40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'],
  [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto'], [Infinity, 'Prestissimo'],
]
const marking = (bpm: number) => MARKINGS.find(([max]) => bpm < max)![1]

const tap = tapTempo((bpm) => setBpm(bpm))

function setBpm(v: number) {
  state.simple.bpm = clamp(Math.round(v), MIN_BPM, MAX_BPM)
  simpleChanged()
}

export const SimpleView: m.Component = {
  view() {
    const s = state.simple
    const pos = state.simplePos
    const playing = state.playing === 'simple'
    return m('.simple', [
      m('header.bar', m('h1', 'Metronome')),

      m('.tempo', [
        m('.marking', marking(s.bpm)),
        m('.tempo-row', [
          m('button.round', { type: 'button', 'aria-label': 'Slower', ...hold(() => setBpm(s.bpm - 1)) }, '−'),
          m('.bpm', [m('span.bpm-num', s.bpm), m('span.bpm-unit', 'BPM')]),
          m('button.round', { type: 'button', 'aria-label': 'Faster', ...hold(() => setBpm(s.bpm + 1)) }, '+'),
        ]),
        m('input.slider[type=range]', {
          min: MIN_BPM, max: MAX_BPM, value: s.bpm, 'aria-label': 'Tempo',
          oninput: (e: Event) => setBpm(+(e.target as HTMLInputElement).value),
        }),
        m('button.tap', { type: 'button', onpointerdown: tap }, 'Tap tempo'),
      ]),

      m('.beats', [
        dots(s.accents.slice(0, s.beats), {
          active: pos?.beat,
          flash: state.flash,
          onTap: (i) => {
            s.accents[i] = nextLevel(s.accents[i])
            simpleChanged()
          },
        }),
      ]),

      m('.settings', [
        m('.field', [
          m('span.field-label', 'Beats per bar'),
          stepper({ get: () => s.beats, set: (v) => { s.beats = v; simpleChanged() }, min: 1, max: 16, label: 'beats' }),
        ]),
        m('.field', [
          m('span.field-label', 'Subdivision'),
          stepper({ get: () => s.subdiv, set: (v) => { s.subdiv = v; simpleChanged() }, min: 1, max: 8, label: 'clicks per beat' }),
        ]),
      ]),

      m('.play-wrap', m('button.play.big', {
        type: 'button', class: playing ? 'on' : '', 'aria-label': playing ? 'Stop' : 'Start',
        onclick: () => toggle('simple'),
      }, playing ? icon.stop() : icon.play())),
    ])
  },
}
