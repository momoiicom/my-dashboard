"use client"

import type { CSSProperties } from "react"
import { accentForeground, appearanceBackground, type Appearance } from "@/lib/appearance"

export function appearanceStyle(appearance: Appearance, boardId: string, previewUrl?: string): CSSProperties {
  return {
    ...(appearanceBackground(appearance.background, boardId, previewUrl) ? { background: appearanceBackground(appearance.background, boardId, previewUrl) } : {}),
    "--primary": appearance.accent,
    "--primary-foreground": accentForeground(appearance.accent),
    "--sidebar-primary": appearance.accent,
    "--sidebar-primary-foreground": accentForeground(appearance.accent),
    "--ring": appearance.accent,
    "--board-accent": appearance.accent,
    "--board-accent-foreground": accentForeground(appearance.accent),
    "--canvas-text": appearance.background.kind === "solid" ? accentForeground(appearance.background.color) : "#ffffff",
  } as CSSProperties
}
export function appearanceTokens(appearance: Appearance, boardId: string): CSSProperties {
  return { ...appearanceStyle(appearance, boardId), background: undefined }
}
