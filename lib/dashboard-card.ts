import type { BotDocument } from "./bot-document"
import { CardKind } from "@/generated/prisma/browser"

export { CardKind }

export type CardInput = {
  title: string
  x: number
  y: number
  width: number
  height: number
  kind?: CardKind
}

export type CardRecord = Omit<CardInput, "kind"> & {
  id: string
  boardId: string
  membershipRevision: number
  kind: CardKind
  externalKey: string | null
  payload: BotDocument | null
  acceptedAt: string | null
  contentRevision: number
}
export type CardPatch = Partial<Omit<CardInput, "kind">>

const limits = {
  x: [0, 10000],
  y: [0, 10000],
  width: [240, 1600],
  height: [160, 1200],
} as const

export function parseCardInput(value: unknown): CardInput | null
export function parseCardInput(value: unknown, partial: true): CardPatch | null
export function parseCardInput(
  value: unknown,
  partial = false
): CardInput | CardPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const keys = Object.keys(data)
  const required = ["title", "x", "y", "width", "height"]
  const allowed = partial ? required : [...required, "kind"]
  if (!keys.length || keys.some((key) => !allowed.includes(key))) return null
  if (!partial && required.some((key) => !(key in data))) return null
  if (
    "kind" in data &&
    !Object.values(CardKind).some((kind) => kind === data.kind)
  )
    return null
  if (
    "title" in data &&
    (typeof data.title !== "string" ||
      data.title.trim().length < 1 ||
      data.title.length > 120)
  )
    return null
  for (const field of ["x", "y", "width", "height"] as const) {
    if (!(field in data)) continue
    const number = data[field]
    const [min, max] = limits[field]
    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number < min ||
      number > max
    )
      return null
  }
  return data as CardInput | CardPatch
}
