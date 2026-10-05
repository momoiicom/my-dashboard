"use client"

import type { CSSProperties } from "react"
import { accentForeground, appearanceBackground, type Appearance } from "@/lib/appearance"
import { appearancePalette, readableTone } from "@/lib/appearance-palette"

export function appearanceStyle(appearance: Appearance, boardId: string, previewUrl?: string): CSSProperties {
  const palette = appearancePalette(appearance)
  return {
    ...(appearanceBackground(appearance.background, boardId, previewUrl) ? { background: appearanceBackground(appearance.background, boardId, previewUrl) } : {}),
    "--primary": palette.button.background,
    "--primary-foreground": palette.button.foreground,
    "--board-button-bg": palette.button.background,
    "--board-button-fg": palette.button.foreground,
    "--board-button-hover": palette.button.hover,
    "--board-main-toolbar-bg": palette.mainToolbar.background,
    "--board-main-toolbar-fg": palette.mainToolbar.foreground,
    "--board-main-toolbar-muted": palette.mainToolbar.muted,
    "--board-main-toolbar-hover": palette.mainToolbar.hover,
    "--board-main-toolbar-border": palette.mainToolbar.border,
    "--board-main-toolbar-error": readableTone("#ff9d96", [palette.mainToolbar.background, palette.mainToolbar.hover]),
    "--board-board-toolbar-bg": palette.boardToolbar.background,
    "--board-board-toolbar-fg": palette.boardToolbar.foreground,
    "--board-board-toolbar-muted": palette.boardToolbar.muted,
    "--board-board-toolbar-hover": palette.boardToolbar.hover,
    "--board-board-toolbar-border": palette.boardToolbar.border,
    "--board-card-bg": palette.card.background,
    "--board-card-fg": palette.card.foreground,
    "--board-card-muted": palette.card.muted,
    "--board-card-hover": palette.card.hover,
    "--board-card-border": palette.card.border,
    "--board-card-focus": palette.card.focus,
    "--board-status-success": readableTone("#7ee2bf", [palette.card.background, palette.card.hover]),
    "--board-status-warning": readableTone("#f5b86c", [palette.card.background, palette.card.hover]),
    "--board-status-danger": readableTone("#f18f9e", [palette.card.background, palette.card.hover]),
    "--board-status-info": readableTone("#85b8ff", [palette.card.background, palette.card.hover]),
    "--board-card-color-scheme": palette.card.foreground === "#000000" ? "light" : "dark",
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
