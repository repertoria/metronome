import m from 'mithril'
import { defaultPiece, examples, startQpm, type Piece } from '../pattern.ts'
import { createPattern, freshName, showPattern, state } from '../state.ts'
import { icon, plural, sheet, tempoChip } from './common.ts'

let showNew = false

function summary(piece: Piece) {
  const sigs = [...new Set(piece.blocks.map((b) => `${b.num}/${b.den}`))]
  return `${plural(piece.blocks.length, 'block')} · ${sigs.join(', ')}`
}

function newSheet() {
  const close = () => (showNew = false)
  const make = (name: string, piece: Piece) => {
    close()
    createPattern(name, piece)
  }
  return sheet(close, [
    m('h2', 'New pattern'),
    m('button.sheet-item', { type: 'button', onclick: () => make(freshName(), defaultPiece()) }, [
      m('b', 'Blank'),
      m('span', 'One block of 4/4. Build it up from there.'),
    ]),
    m('p.hint', 'Or start from an example:'),
    examples.map((ex) =>
      m('button.sheet-item', { type: 'button', onclick: () => make(ex.name, ex.make()) }, [m('b', ex.name), m('span', ex.desc)]),
    ),
    m('button.btn.wide', { type: 'button', onclick: close }, 'Cancel'),
  ])
}

export function libraryView() {
  const patterns = [...state.patterns].sort((a, b) => b.updated - a.updated)
  return m('.library', [
    m('header.bar', [
      m('h1', 'Patterns'),
      m('button.text-btn', { type: 'button', onclick: () => (showNew = true) }, 'New'),
    ]),
    patterns.length === 0
      ? m('.empty', [
          m('h2', 'No patterns yet'),
          m('p', 'Build a sequence of meters, accents and tempo changes, then play it back at any tempo.'),
          m('button.btn.primary.wide', { type: 'button', onclick: () => (showNew = true) }, 'Create a pattern'),
        ])
      : m('.cards', patterns.map((p) =>
          m('button.card.pat', { key: p.id, type: 'button', onclick: () => showPattern(p.id) }, [
            m('.pat-main', [m('b.pat-name', p.name), m('span.pat-sum', summary(p.piece))]),
            m('span.card-tempo', tempoChip(p.piece.startUnit, startQpm(p.piece))),
            icon.chevron(),
          ]),
        )),
    showNew && newSheet(),
  ])
}
