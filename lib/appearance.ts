export type Background = { kind: "default" } | { kind: "solid"; color: string } | { kind: "image"; assetId: string }
export const APPEARANCE_SURFACES = ["mainToolbar", "boardToolbar", "card", "button"] as const
export type AppearanceSurface = typeof APPEARANCE_SURFACES[number]
export type AppearanceColors = Partial<Record<AppearanceSurface, string>>
export type ViewerColors = Partial<Record<AppearanceSurface, string | "auto">>
export type Appearance = { background: Background; accent: string; colors?: AppearanceColors }
export type ViewerPreferences = { background: Background | null; accent: string | null; colors?: ViewerColors }
export type AppearanceState = {
  effective: Appearance
  author: Appearance
  preferences: { role: "author"; value: Appearance } | { role: "viewer"; value: ViewerPreferences }
  source: { background: "author" | "personal"; accent: "author" | "personal" }
  token: string
}
export type UploadChoice = { kind: "upload" }
export type AppearanceChoice = Background | UploadChoice
export type AppearanceTarget = { boardId: string; token: string }
export type SaveAppearance = { expectedToken: string; targets?: AppearanceTarget[]; preferences: { role: "author"; background: AppearanceChoice; accent: string; colors?: AppearanceColors } | { role: "viewer"; background: AppearanceChoice | null; accent: string | null; colors?: ViewerColors } }
export const DEFAULT_APPEARANCE: Appearance = { background: { kind: "default" }, accent: "#0c66e4" }

export function resolveAppearance(author: Appearance, personal: ViewerPreferences | null): Appearance {
  const colors: AppearanceColors = { ...author.colors }
  for (const surface of APPEARANCE_SURFACES) {
    const choice = personal?.colors?.[surface]
    if (choice === "auto") delete colors[surface]
    else if (choice) colors[surface] = choice
  }
  return { background: personal?.background ?? author.background, accent: personal?.accent ?? author.accent, ...(Object.keys(colors).length ? { colors } : {}) }
}

function parseColors(value: unknown, viewer: boolean): AppearanceColors | ViewerColors | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !APPEARANCE_SURFACES.includes(key as AppearanceSurface))) return null
  const colors: ViewerColors = {}
  for (const surface of APPEARANCE_SURFACES) {
    if (!(surface in record)) continue
    const color = record[surface] === "auto" && viewer ? "auto" : parseHex(record[surface])
    if (!color) return null
    colors[surface] = color
  }
  return colors
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
  if (Object.keys(body).some(key => !["expectedToken", "preferences", "targets"].includes(key)) || typeof body.expectedToken !== "string" || !/^[0-9]+:[0-9]+$/.test(body.expectedToken)) return null
  let targets: AppearanceTarget[] | undefined
  if ("targets" in body) {
    if (!Array.isArray(body.targets) || !body.targets.length || body.targets.length > 200) return null
    targets = []
    for (const value of body.targets) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null
      const target = value as Record<string, unknown>
      if (Object.keys(target).length !== 2 || typeof target.boardId !== "string" || !/^b_[a-f0-9]{32}$/.test(target.boardId) || typeof target.token !== "string" || !/^[0-9]+:[0-9]+$/.test(target.token) || targets.some(item => item.boardId === target.boardId)) return null
      targets.push({ boardId: target.boardId, token: target.token })
    }
  }
  const preferences = body.preferences
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return null
  const choice = preferences as Record<string, unknown>
  if (choice.role === "author" && Object.keys(choice).every(key => ["role", "background", "accent", "colors"].includes(key)) && Object.keys(choice).length >= 3) {
    const background = parseBackground(choice.background, true)
    const accent = parseHex(choice.accent)
    const colors = "colors" in choice ? parseColors(choice.colors, false) : undefined
    return background && accent && colors !== null ? { expectedToken: body.expectedToken, ...(targets ? { targets } : {}), preferences: { role: "author", background, accent, ...(colors ? { colors } : {}) } } : null
  }
  if (choice.role === "viewer" && Object.keys(choice).every(key => ["role", "background", "accent", "colors"].includes(key)) && Object.keys(choice).length >= 3) {
    const background = choice.background === null ? null : parseBackground(choice.background, true)
    const accent = choice.accent === null ? null : parseHex(choice.accent)
    const colors = "colors" in choice ? parseColors(choice.colors, true) : undefined
    return colors !== null && (choice.background === null || background) && (choice.accent === null || accent)
      ? { expectedToken: body.expectedToken, ...(targets ? { targets } : {}), preferences: { role: "viewer", background, accent, ...(colors ? { colors } : {}) } } : null
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
