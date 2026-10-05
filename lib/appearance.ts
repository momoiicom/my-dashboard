export type Background = { kind: "default" } | { kind: "solid"; color: string } | { kind: "image"; assetId: string }
export type Appearance = { background: Background; accent: string }
export type ViewerPreferences = { background: Background | null; accent: string | null }
export type AppearanceState = {
  effective: Appearance
  author: Appearance
  preferences: { role: "author"; value: Appearance } | { role: "viewer"; value: ViewerPreferences }
  source: { background: "author" | "personal"; accent: "author" | "personal" }
  token: string
}
export type UploadChoice = { kind: "upload" }
export type AppearanceChoice = Background | UploadChoice
export type SaveAppearance = { expectedToken: string; preferences: { role: "author"; background: AppearanceChoice; accent: string } | { role: "viewer"; background: AppearanceChoice | null; accent: string | null } }
export const DEFAULT_APPEARANCE: Appearance = { background: { kind: "default" }, accent: "#0c66e4" }

export function resolveAppearance(author: Appearance, personal: ViewerPreferences | null): Appearance {
  return { background: personal?.background ?? author.background, accent: personal?.accent ?? author.accent }
}

export function parseHex(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null
}

export function parseBackground(value: unknown, uploadAllowed: boolean): AppearanceChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.kind === "default" && Object.keys(record).length === 1) return { kind: "default" }
  if (record.kind === "solid" && Object.keys(record).length === 2) {
    const color = parseHex(record.color)
    return color ? { kind: "solid", color } : null
  }
  if (record.kind === "image" && Object.keys(record).length === 2 && typeof record.assetId === "string" && /^a_[a-f0-9]{32}$/.test(record.assetId)) return { kind: "image", assetId: record.assetId }
  if (uploadAllowed && record.kind === "upload" && Object.keys(record).length === 1) return { kind: "upload" }
  return null
}

export function parseSaveAppearance(value: unknown): SaveAppearance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (Object.keys(body).length !== 2 || typeof body.expectedToken !== "string" || !/^[0-9]+:[0-9]+$/.test(body.expectedToken)) return null
  const preferences = body.preferences
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return null
  const choice = preferences as Record<string, unknown>
  if (choice.role === "author" && Object.keys(choice).length === 3) {
    const background = parseBackground(choice.background, true)
    const accent = parseHex(choice.accent)
    return background && accent ? { expectedToken: body.expectedToken, preferences: { role: "author", background, accent } } : null
  }
  if (choice.role === "viewer" && Object.keys(choice).length === 3) {
    const background = choice.background === null ? null : parseBackground(choice.background, true)
    const accent = choice.accent === null ? null : parseHex(choice.accent)
    return (choice.background === null || background) && (choice.accent === null || accent)
      ? { expectedToken: body.expectedToken, preferences: { role: "viewer", background, accent } } : null
  }
  return null
}

export function appearanceBackground(background: Background, boardId: string, previewUrl?: string): string | undefined {
  if (previewUrl) return `linear-gradient(rgba(5,13,25,.15),rgba(5,13,25,.32)),url("${previewUrl}") center / cover`
  if (background.kind === "default") return undefined
  if (background.kind === "solid") return background.color
  return `linear-gradient(rgba(5,13,25,.15),rgba(5,13,25,.32)),url('/api/boards/${boardId}/appearance/assets/${background.assetId}') center / cover`
}

export function accentForeground(hex: string): string {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
  return luminance > .179 ? "#000000" : "#ffffff"
}
