export type CardInput = {
  title: string
  x: number
  y: number
  width: number
  height: number
}

export type CardRecord = CardInput & { id: string }

const limits = {
  x: [0, 10000],
  y: [0, 10000],
  width: [240, 1600],
  height: [160, 1200],
} as const

export function parseCardInput(value: unknown): CardInput | null
export function parseCardInput(value: unknown, partial: true): Partial<CardInput> | null
export function parseCardInput(value: unknown, partial = false): Partial<CardInput> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const keys = Object.keys(data)
  const allowed = ["title", "x", "y", "width", "height"]
  if (!keys.length || keys.some((key) => !allowed.includes(key))) return null
  if (!partial && keys.length !== allowed.length) return null
  if ("title" in data && (typeof data.title !== "string" || data.title.trim().length < 1 || data.title.length > 120)) return null
  for (const field of ["x", "y", "width", "height"] as const) {
    if (!(field in data)) continue
    const number = data[field]
    const [min, max] = limits[field]
    if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max) return null
  }
  return data as Partial<CardInput>
}
