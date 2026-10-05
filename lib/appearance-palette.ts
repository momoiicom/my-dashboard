import { APPEARANCE_SURFACES, accentForeground, type Appearance, type AppearanceSurface } from "@/lib/appearance"

type SurfacePalette = { background: string; foreground: string; muted: string; hover: string; border: string; focus: string }

function blend(from: string, to: string, portion: number): string {
  const channels = [1, 3, 5].map(index => Math.round(parseInt(from.slice(index, index + 2), 16) * (1 - portion) + parseInt(to.slice(index, index + 2), 16) * portion))
  return `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
}

export function readableTone(color: string, backgrounds: string[]): string {
  const foreground = accentForeground(backgrounds[0])
  const luminances = backgrounds.map(luminance)
  for (let step = 0; step <= 100; step++) {
    const candidate = blend(color, foreground, step / 100)
    const value = luminance(candidate)
    if (luminances.every(background => (Math.max(value, background) + .05) / (Math.min(value, background) + .05) >= 4.5)) return candidate
  }
  return foreground
}

function palette(background: string): SurfacePalette {
  const foreground = accentForeground(background)
  return {
    background,
    foreground,
    muted: readableTone(blend(background, foreground, .68), [background]),
    hover: blend(background, foreground === "#000000" ? "#ffffff" : "#000000", .12),
    border: blend(background, foreground, foreground === "#000000" ? .24 : .28),
    focus: foreground,
  }
}

export function appearancePalette(appearance: Appearance): Record<AppearanceSurface, SurfacePalette> {
  const accent = appearance.accent
  const automatic: Record<AppearanceSurface, string> = {
    mainToolbar: blend("#09111d", accent, .16),
    boardToolbar: blend("#09111d", accent, .24),
    card: blend("#222b38", accent, .08),
    button: accent,
  }
  return Object.fromEntries(APPEARANCE_SURFACES.map(key => [key, palette(appearance.colors?.[key] ?? automatic[key])])) as Record<AppearanceSurface, SurfacePalette>
}
