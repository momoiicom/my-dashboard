export type ArrangeCard = { id: string; x: number; y: number; width: number; height: number }
export type CardPosition = { cardId: string; x: number; y: number }

export function arrange(cards: readonly ArrangeCard[], viewportWidth: number): CardPosition[] {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0)
    throw new Error("The canvas has no visible width. Please try again.")
  const ordered = [...cards].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  let x = 20
  let y = 20
  let rowHeight = 0
  let rowCount = 0
  const positions: CardPosition[] = []
  for (const card of ordered) {
    if (rowCount && (x + card.width > viewportWidth - 20 || x > 10000)) {
      y = Math.ceil((y + rowHeight + 20) / 20) * 20
      x = 20
      rowHeight = 0
      rowCount = 0
    }
    if (x > 10000 || y > 10000)
      throw new Error("This arrangement exceeds the board’s capacity. Your layout has been kept.")
    positions.push({ cardId: card.id, x, y })
    rowHeight = Math.max(rowHeight, card.height)
    rowCount++
    x = Math.ceil((x + card.width + 20) / 20) * 20
  }
  return positions
}
