import assert from "node:assert/strict"
import { arrange, type ArrangeCard } from "../lib/arrange"

const cards: ArrangeCard[] = [
  { id: "c", x: 45, y: 50, width: 121, height: 61 },
  { id: "a", x: 20, y: 20, width: 101, height: 95 },
  { id: "b", x: 40, y: 20, width: 81, height: 43 },
]
assert.deepEqual(arrange([], 400), [])
assert.throws(() => arrange(cards, 0), /visible width/i)
assert.throws(() => arrange(cards, Number.NaN), /visible width/i)
assert.deepEqual(arrange(cards, 500), [
  { cardId: "a", x: 20, y: 20 },
  { cardId: "b", x: 160, y: 20 },
  { cardId: "c", x: 280, y: 20 },
])
assert.deepEqual(arrange(cards, 300), [
  { cardId: "a", x: 20, y: 20 },
  { cardId: "b", x: 160, y: 20 },
  { cardId: "c", x: 20, y: 140 },
])
assert.deepEqual(arrange(cards, 150), [
  { cardId: "a", x: 20, y: 20 },
  { cardId: "b", x: 20, y: 140 },
  { cardId: "c", x: 20, y: 220 },
])
const oversized = { id: "wide", x: 5, y: 5, width: 800, height: 41 }
assert.deepEqual(arrange([oversized, cards[0]], 180), [
  { cardId: "wide", x: 20, y: 20 },
  { cardId: "c", x: 20, y: 100 },
])
assert.deepEqual(arrange([cards[0]], 200), [{ cardId: "c", x: 20, y: 20 }])
const arranged = cards.map(card => ({ ...card, ...arrange(cards, 300).find(position => position.cardId === card.id)! }))
assert.deepEqual(arrange(arranged, 300), [
  { cardId: "a", x: 20, y: 20 }, { cardId: "b", x: 160, y: 20 }, { cardId: "c", x: 20, y: 140 },
], "A second click keeps the fixed placement")
assert.deepEqual(arrange([{ ...cards[0], id: "z", x: 0, y: 0 }, { ...cards[1], id: "a", x: 0, y: 0 }], 500), [
  { cardId: "a", x: 20, y: 20 }, { cardId: "z", x: 160, y: 20 },
], "Equal coordinates use lexical IDs")
const tall = Array.from({ length: 101 }, (_, i) => ({
  id: String(i).padStart(3, "0"), x: 20, y: i, width: 200, height: 90,
}))
assert.throws(() => arrange(tall, 220), /capacity/i)
console.log("Auto-layout deterministic placements and capacity: passed")
