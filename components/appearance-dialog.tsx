"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { accentForeground, appearanceBackground, DEFAULT_APPEARANCE, parseHex, resolveAppearance, type Appearance, type AppearanceChoice, type AppearanceState, type SaveAppearance } from "@/lib/appearance"
import { appearanceTokens } from "@/components/appearance-surface"

function initialDraft(state: AppearanceState): SaveAppearance["preferences"] {
  return state.preferences.role === "author"
    ? { role: "author", ...state.preferences.value }
    : { role: "viewer", ...state.preferences.value }
}

function visibleAppearance(draft: SaveAppearance["preferences"], state: AppearanceState): Appearance {
  if (draft.role === "author") return { background: draft.background.kind === "upload" ? state.effective.background : draft.background, accent: draft.accent }
  return resolveAppearance(state.author, { background: draft.background?.kind === "upload" ? state.effective.background : draft.background, accent: draft.accent })
}

export function AppearanceDialog({ boardId, boardName, state, onClose, onPreview, onSaved, onBaseline, onSaving }: {
  boardId: string; boardName: string; state: AppearanceState
  onClose: () => void; onPreview: (value: { appearance: Appearance; previewUrl?: string } | null) => void
  onSaved: (value: AppearanceState) => void; onBaseline: (value: AppearanceState) => void; onSaving: () => void
}) {
  const [draft, setDraft] = useState<SaveAppearance["preferences"]>(() => initialDraft(state))
  const [baseToken, setBaseToken] = useState(state.token)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>()
  const [backgroundHex, setBackgroundHex] = useState(state.effective.background.kind === "solid" ? state.effective.background.color : "#10243b")
  const [accentHex, setAccentHex] = useState(state.effective.accent)
  const [pending, setPending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const preview = useMemo(() => visibleAppearance(draft, state), [draft, state])
  const selectedBackground = draft.background
  const backgroundMode = selectedBackground === null ? "inherit" : selectedBackground.kind
  const accentValue = draft.accent ?? state.author.accent
  const accentInherited = draft.role === "viewer" && draft.accent === null
  const invalidColor = (selectedBackground?.kind === "solid" && !parseHex(backgroundHex)) || (!accentInherited && !parseHex(accentHex))

  useEffect(() => { onPreview({ appearance: preview, previewUrl }) }, [preview, previewUrl, onPreview])
  useEffect(() => () => { generation.current++; request.current?.abort(); onPreview(null) }, [onPreview])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  function close() { generation.current++; request.current?.abort(); onClose() }
  function setBackground(background: AppearanceChoice | null) {
    setDraft(current => ({ ...current, background } as SaveAppearance["preferences"]))
    if (background?.kind !== "upload") { setFile(null); setPreviewUrl(undefined) }
  }
  function setAccent(accent: string | null) { setDraft(current => ({ ...current, accent } as SaveAppearance["preferences"])) }
  function reset() {
    if (pending || refreshing) return
    setDraft(draft.role === "author" ? { role: "author", ...DEFAULT_APPEARANCE } : { role: "viewer", background: null, accent: null })
    setFile(null); setPreviewUrl(undefined); setError(""); setConflict(false)
    setBackgroundHex("#10243b"); setAccentHex(DEFAULT_APPEARANCE.accent)
  }
  async function refresh(reapply: boolean) {
    const currentGeneration = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setRefreshing(true)
    try {
      const response = await fetch(`/api/boards/${boardId}/appearance`, { cache: "no-store", signal: controller.signal })
      if (!response.ok) throw new Error("Could not reload appearance")
      const latest = await response.json() as AppearanceState
      if (currentGeneration !== generation.current) return
      onBaseline(latest)
      setBaseToken(latest.token)
      if (!reapply) { setDraft(initialDraft(latest)); setFile(null); setPreviewUrl(undefined); setAccentHex(latest.effective.accent); setBackgroundHex(latest.effective.background.kind === "solid" ? latest.effective.background.color : "#10243b") }
      setConflict(false); setError("")
    } catch (cause) { if (currentGeneration === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not reload appearance") }
    finally { if (currentGeneration === generation.current) setRefreshing(false) }
  }
  async function save() {
    if (pending || refreshing || conflict || invalidColor) return
    const currentGeneration = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setPending(true); setError("")
    onSaving()
    const form = new FormData()
    form.set("preferences", JSON.stringify({ expectedToken: baseToken, preferences: draft }))
    if (file) form.set("image", file)
    try {
      const response = await fetch(`/api/boards/${boardId}/appearance`, { method: "PUT", body: form, signal: controller.signal })
      const result = await response.json()
      if (currentGeneration !== generation.current) return
      if (response.status === 409) { setConflict(true); setError("Appearance changed on another device. Reload it or reapply your choices."); return }
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not save appearance")
      onSaved(result as AppearanceState)
    } catch (cause) {
      if (currentGeneration === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not save appearance")
    } finally { if (currentGeneration === generation.current) setPending(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="appearance-dialog" style={appearanceTokens(preview, boardId)}>
      <DialogHeader><DialogTitle>Appearance for {boardName}</DialogTitle><DialogDescription>{draft.role === "author" ? "Set the defaults for this board and its viewers." : "Your choices on this board are private to you."} Preview changes here, then save.</DialogDescription></DialogHeader>
      <div className="appearance-preview" style={{ background: appearanceBackground(preview.background, boardId, previewUrl) }} aria-label="Live board preview">
        <div className="appearance-preview-bar"><span>Dashboard</span><span className="appearance-preview-active" style={{ background: preview.accent, color: accentForeground(preview.accent) }}>{draft.role === "author" ? "Edit layout" : "Customize my layout"}</span></div>
        <div className="appearance-preview-card">Board preview</div>
      </div>
      <fieldset className="appearance-fields" disabled={pending || refreshing}><legend>Background</legend>
        <div className="appearance-options">
          {draft.role === "viewer" && <label><input type="radio" name="background" checked={backgroundMode === "inherit"} onChange={() => setBackground(null)} /> Use author&apos;s background</label>}
          <label><input type="radio" name="background" checked={backgroundMode === "default"} onChange={() => setBackground({ kind: "default" })} /> Built-in image</label>
          <label><input type="radio" name="background" checked={backgroundMode === "solid"} onChange={() => { const color = selectedBackground?.kind === "solid" ? selectedBackground.color : "#10243b"; setBackgroundHex(color); setBackground({ kind: "solid", color }) }} /> Solid color</label>
          <label><input type="radio" name="background" checked={backgroundMode === "image" || backgroundMode === "upload"} onChange={() => document.getElementById(`appearance-file-${boardId}`)?.click()} /> My image</label>
        </div>
        {selectedBackground?.kind === "solid" && <div className="appearance-color"><input aria-label="Background color picker" type="color" value={selectedBackground.color} onChange={event => { setBackgroundHex(event.target.value); setBackground({ kind: "solid", color: event.target.value }) }} /><input aria-label="Background hex color" aria-invalid={!parseHex(backgroundHex)} value={backgroundHex} onChange={event => { setBackgroundHex(event.target.value); const color = parseHex(event.target.value); if (color) setBackground({ kind: "solid", color }) }} /></div>}
        <input id={`appearance-file-${boardId}`} aria-label="Choose background image" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
          const chosen = event.target.files?.[0]
          event.currentTarget.value = ""
          if (!chosen) return
          if (chosen.size > 10 * 1024 * 1024) { setError("Image must be at most 10 MiB"); return }
          setFile(chosen); setPreviewUrl(URL.createObjectURL(chosen)); setBackground({ kind: "upload" }); setError("")
        }} />
      </fieldset>
      <fieldset className="appearance-fields" disabled={pending || refreshing}><legend>Accent</legend>
        {draft.role === "viewer" && <label><input type="checkbox" checked={accentInherited} onChange={event => { setAccent(event.target.checked ? null : state.author.accent); setAccentHex(state.author.accent) }} /> Use author&apos;s accent</label>}
        <div className="appearance-color"><input aria-label="Accent color picker" type="color" value={accentValue} disabled={accentInherited} onChange={event => { setAccentHex(event.target.value); setAccent(event.target.value) }} /><input aria-label="Accent hex color" aria-invalid={!accentInherited && !parseHex(accentHex)} value={accentInherited ? state.author.accent : accentHex} disabled={accentInherited} onChange={event => { setAccentHex(event.target.value); const color = parseHex(event.target.value); if (color) setAccent(color) }} /></div>
      </fieldset>
      {invalidColor && <p role="alert" className="appearance-error">Enter a six-digit hex color such as #123abc.</p>}
      {error && <p role="alert" className="appearance-error">{error}</p>}
      {conflict && <div className="appearance-conflict"><Button variant="outline" disabled={refreshing} onClick={() => void refresh(false)}>Reload saved appearance</Button><Button variant="outline" disabled={refreshing} onClick={() => void refresh(true)}>Reapply my choices</Button></div>}
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="button" variant="outline" disabled={pending || refreshing} onClick={reset}>Reset</Button><Button type="button" disabled={pending || refreshing || conflict || Boolean(invalidColor)} onClick={() => void save()}>{pending ? "Saving…" : "Save appearance"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
