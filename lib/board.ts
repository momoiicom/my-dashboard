import type { CardRecord } from "./dashboard-card"

export type BoardRecord = {
  role?: "author" | "viewer"
  author?: { name: string | null; email: string | null }
  id: string
  name: string
  isOriginal: boolean
  createdAt: string
}
export type WorkspaceSnapshot = {
  boards: BoardRecord[]
  originalBoardId: string
}
export type BoardSnapshot = { board: BoardRecord; cards: CardRecord[]; layoutToken?: string; role?: "author" | "viewer" }
export type MoveInput = { sourceBoardId: string; destinationBoardId: string }
export type MoveResult = { card: CardRecord; moved: boolean }

export function isBoardId(value: unknown): value is string {
  return typeof value === "string" && /^b_[a-f0-9]{32}$/.test(value)
}

export function boardHref(id: string) {
  return `/boards/${id}`
}

export function workspaceCallbackUrl(value: unknown): string {
  return typeof value === "string" &&
    (value === "/" || /^\/boards\/b_[a-f0-9]{32}$/.test(value))
    ? value
    : "/"
}

export function parseBoardName(
  value: unknown
): { name: string; nameKey: string } | null {
  if (typeof value !== "string") return null
  const name = value.trim()
  if (!name || [...name].length > 120) return null
  return { name, nameKey: name.toLowerCase() }
}
