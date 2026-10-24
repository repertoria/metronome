import m from 'mithril'
import { defaultPiece, startQpm, type Piece } from '../pattern.ts'
import { createPattern, freshName, showPattern, state } from '../state.ts'
import { icon, plural, tempoChip } from './common.ts'

function summary(piece: Piece) {
  const sigs = [...new Set(piece.blocks.map((b) => `${b.num}/${b.den}`))]
  return `${plural(piece.blocks.length, 'block')} · ${sigs.join(', ')}`
}

const newPattern = () => createPattern(freshName(), defaultPiece())

export function libraryView() {
  const patterns = [...state.patterns].sort((a, b) => b.updated - a.updated)
  return m('.library', [
    m('header.bar', [
      m('h1', 'Patterns'),
      m('button.text-btn', { type: 'button', onclick: newPattern }, 'New'),
    ]),
    patterns.length === 0
      ? m('.empty', [
          m('h2', 'No patterns yet'),
          m('p', 'Build a sequence of meters, accents and tempo changes, then play it back at any tempo.'),
          m('button.btn.primary.wide', { type: 'button', onclick: newPattern }, 'Create a pattern'),
        ])
      : m('.cards', patterns.map((p) =>
          m('button.card.pat', { key: p.id, type: 'button', onclick: () => showPattern(p.id) }, [
            m('.pat-main', [m('b.pat-name', p.name), m('span.pat-sum', summary(p.piece))]),
            m('span.card-tempo', tempoChip(p.piece.startUnit, startQpm(p.piece), p.piece.blocks[0])),
            icon.chevron(),
          ]),
        )),
  ])
}
