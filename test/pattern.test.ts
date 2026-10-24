import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCENT, BAR, NORMAL, SILENT, SOFT, PatternSource, beatUnit, defaultPiece, fromQpm, groupings, makeBlock, migratePiece,
  plan, setFixed, setTargetBpm, targetBpm, tempos, type Piece,
} from '../src/pattern.ts'

// ---- The spec's worked examples -------------------------------------------

const examples: { name: string; desc: string; make: () => Piece }[] = [
  {
    name: '6/8 ↔ 2/4',
    desc: 'Alternating bars: 6/8 at dotted quarter = 60, 2/4 at quarter = 90. The eighth note stays constant.',
    make: () => ({
      startBpm: 60,
      startUnit: 3 / 8,
      loop: true,
      blocks: [
        makeBlock({ num: 6, den: 8, bars: 1 }),
        makeBlock({ num: 2, den: 4, bars: 1, sub: true, repeat: 0, repeatSpan: 2 }),
      ],
    }),
  },
  {
    name: '5/8 → 6/8',
    desc: 'Ten bars of 5/8 clicking on 1 and 3, then one bar of 6/8 in dotted quarters.',
    make: () => ({
      startBpm: 240,
      startUnit: 1 / 8,
      loop: true,
      blocks: [
        makeBlock({ num: 5, den: 8, bars: 10, sub: false, groups: [2, 3] }),
        makeBlock({ num: 6, den: 8, bars: 1, sub: false, groups: [3, 3] }),
      ],
    }),
  },
  {
    name: '120 → 100',
    desc: 'Four bars at quarter = 120, then three bars at 100. Change the start tempo and both scale together.',
    make: () => ({
      startBpm: 120,
      startUnit: 1 / 4,
      loop: true,
      blocks: [makeBlock({ bars: 4 }), makeBlock({ bars: 3, tempoMode: 'set', rel: 100 / 120 })],
    }),
  },
  {
    name: 'Accelerando',
    desc: 'Two bars at quarter = 80, then speed up gradually to 120 over eight bars, and hold.',
    make: () => ({
      startBpm: 80,
      startUnit: 1 / 4,
      loop: false,
      blocks: [makeBlock({ bars: 2 }), makeBlock({ bars: 8, tempoMode: 'ramp', rel: 1.5 }), makeBlock({ bars: 4 })],
    }),
  },
]

const piece = (startBpm: number, blocks: Piece['blocks'], startUnit = 1 / 4): Piece => ({ startBpm, startUnit, loop: false, blocks })

const run = (piece: Piece, n: number) => {
  const src = new PatternSource(() => ({ piece, version: 0 }))
  const out = []
  for (let i = 0; i < n; i++) {
    const t = src.next()
    if (!t) break
    out.push(t)
  }
  return out
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`)

test('6/8 at dotted quarter = 60 then 2/4 keeps the pulse: quarter = 90', () => {
  const piece = examples[0].make()
  const [a, b] = tempos(piece)
  close(fromQpm(a.start, beatUnit(6, 8)), 60)
  close(fromQpm(b.start, beatUnit(2, 4)), 90)
  // every eighth note lasts 1/3 s in both meters, and the pair alternates forever
  const ticks = run(piece, 6 + 4 + 6 + 4)
  assert.equal(ticks.length, 20)
  for (const t of ticks) close(t.dur, 1 / 3)
  const blocks = ticks.map((t) => (t.meta as { block: number }).block)
  assert.deepEqual(blocks, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1])
})

test('ten bars of 5/8 on 1 and 3, then one bar of 6/8 in dotted quarters', () => {
  const piece = examples[1].make()
  piece.loop = false
  assert.deepEqual(piece.blocks[0].pattern, [ACCENT, SILENT, NORMAL, SILENT, SILENT])
  assert.deepEqual(piece.blocks[1].pattern, [ACCENT, SILENT, SILENT, NORMAL, SILENT, SILENT])
  const ticks = run(piece, 1000)
  assert.equal(ticks.length, 10 * 5 + 6)
  const eighth = ticks[0].dur
  for (const t of ticks) close(t.dur, eighth)
})

test('four bars at quarter = 120 then three at 100', () => {
  const piece = examples[2].make()
  piece.loop = false
  const ticks = run(piece, 1000)
  // 4/4 is 8 eighth-note pulses per bar
  assert.equal(ticks.length, 7 * 8)
  close(ticks[0].dur, 0.25)
  close(ticks[4 * 8 - 1].dur, 0.25)
  close(ticks[4 * 8].dur, 0.3)
})

test('ramp moves linearly from the previous tempo to the target', () => {
  const p = piece(60, [makeBlock({ bars: 1 }), makeBlock({ bars: 2, tempoMode: 'ramp', rel: 2 })])
  const ticks = run(p, 1000).slice(8)
  close(ticks[0].dur, 0.5) // starts at 60
  close(ticks[8].dur, 30 / 90) // halfway: 90
  assert.ok(ticks[15].dur > 0.25)
})

test('note equivalence: old dotted quarter = new quarter', () => {
  const p = piece(60, [makeBlock({ num: 6, den: 8, bars: 1 }), makeBlock({ num: 2, den: 4, tempoMode: 'equiv', equivOld: 3 / 8, equivNew: 1 / 4 })], 3 / 8)
  close(fromQpm(tempos(p)[1].start, 1 / 4), 60)
})

test('repeat brackets and endless loops', () => {
  const pc = piece(120, [makeBlock({ bars: 1 }), makeBlock({ bars: 2 }), makeBlock({ bars: 1, repeat: 3, repeatSpan: 2 }), makeBlock({ bars: 1 })])
  assert.deepEqual(plan(pc).bars.map((b) => b.block), [0, 1, 1, 2, 1, 1, 2, 1, 1, 2, 3])
  pc.blocks[2].repeat = 0
  const p = plan(pc)
  assert.equal(p.loopStart, 1)
  assert.equal(p.bars.length, 4)
})

test('grouping presets', () => {
  assert.deepEqual(groupings(5, 8).slice(0, 2), [[2, 3], [3, 2]])
  assert.deepEqual(groupings(6, 8)[0], [3, 3])
  assert.deepEqual(groupings(7, 8).slice(0, 3), [[2, 2, 3], [2, 3, 2], [3, 2, 2]])
})

test('relative tempos follow the start tempo; fixed ones do not', () => {
  const p = examples[2].make() // 120 → 100
  p.blocks.push(makeBlock({ tempoMode: 'set' }))
  setTargetBpm(p, p.blocks[2], 140)
  setFixed(p, p.blocks[2], true)
  p.startBpm = 90
  const [a, b, c] = tempos(p).map((t) => fromQpm(t.start, 1 / 4))
  close(a, 90)
  close(b, 75)
  close(c, 140)
  // switching back to relative keeps the tempo it plays now
  setFixed(p, p.blocks[2], false)
  close(targetBpm(p, p.blocks[2]), 140)
  p.startBpm = 45
  close(targetBpm(p, p.blocks[2]), 70)
})

test('v1 pieces migrate to a start tempo with relative blocks', () => {
  const old = {
    loop: true,
    blocks: [{ ...makeBlock(), bpm: 120, unit: 1 / 4 }, { ...makeBlock({ tempoMode: 'set' }), bpm: 100, unit: 1 / 4 }],
  } as unknown as Piece
  for (const b of old.blocks) delete (b as Partial<typeof b>).fixed
  const p = migratePiece(old)
  assert.equal(p.startBpm, 120)
  close(fromQpm(tempos(p)[1].start, 1 / 4), 100)
  assert.equal(migratePiece(defaultPiece()).startBpm, 120)
})

test('tempo counted in bars: 5/8 in 2+3 at bar = 80', () => {
  const p = piece(80, [makeBlock({ num: 5, den: 8, bars: 1, groups: [2, 3] })], BAR)
  assert.deepEqual(p.blocks[0].pattern, [ACCENT, SOFT, NORMAL, SOFT, SOFT])
  const ticks = run(p, 100)
  assert.equal(ticks.length, 5)
  // 80 bars a minute → each bar 0.75 s → each eighth 0.15 s (♪ = 400)
  for (const t of ticks) close(t.dur, 0.15)
  close(fromQpm(tempos(p)[0].start, 1 / 8), 400)
})

test('bar tempos follow each block\'s own meter', () => {
  const p = piece(80, [
    makeBlock({ num: 5, den: 8, bars: 1 }),
    // new bar = old bar: the 6/8 bar lasts as long as the 5/8 bar did
    makeBlock({ num: 6, den: 8, bars: 1, tempoMode: 'equiv', equivOld: BAR, equivNew: BAR }),
    // fixed bar = 60 in 3/4: one bar per second
    makeBlock({ num: 3, den: 4, bars: 1, tempoMode: 'set', fixed: true, unit: BAR, bpm: 60 }),
  ], BAR)
  const ticks = run(p, 100)
  const barLen = (block: number) =>
    ticks.filter((t) => (t.meta as { block: number }).block === block).reduce((s, t) => s + t.dur, 0)
  close(barLen(0), 0.75)
  close(barLen(1), 0.75)
  close(barLen(2), 1)
  close(targetBpm(p, p.blocks[2]), 60)
  // a relative target shown in bars converts through the block's meter
  setFixed(p, p.blocks[2], false)
  setTargetBpm(p, p.blocks[2], 40)
  close(targetBpm(p, p.blocks[2]), 40)
  close(run(p, 100).slice(11).reduce((s, t) => s + t.dur, 0), 1.5)
})
