"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { APPEARANCE_SURFACES, appearanceBackground, DEFAULT_APPEARANCE, parseHex, resolveAppearance, type Appearance, type AppearanceChoice, type AppearanceState, type AppearanceSurface, type AppearanceTarget, type SaveAppearance, type ViewerColors } from "@/lib/appearance"
import { appearancePalette } from "@/lib/appearance-palette"
import { appearanceTokens } from "@/components/appearance-surface"
import { prepareWallpaper } from "@/lib/prepare-wallpaper"

function initialDraft(state: AppearanceState): SaveAppearance["preferences"] {
  return state.preferences.role === "author"
    ? { role: "author", ...state.preferences.value, colors: state.preferences.value.colors ?? {} }
    : { role: "viewer", ...state.preferences.value, colors: state.preferences.value.colors ?? {} }
}

function visibleAppearance(draft: SaveAppearance["preferences"], state: AppearanceState): Appearance {
  if (draft.role === "author") return { background: draft.background.kind === "upload" ? state.effective.background : draft.background, accent: draft.accent, ...(draft.colors && Object.keys(draft.colors).length ? { colors: draft.colors } : {}) }
  return resolveAppearance(state.author, { background: draft.background?.kind === "upload" ? state.effective.background : draft.background, accent: draft.accent, colors: draft.colors })
}

const SURFACE_LABELS: Record<AppearanceSurface, string> = { mainToolbar: "Main toolbar", boardToolbar: "Board toolbar", card: "Cards", button: "Buttons" }

function imageSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
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
  const [surfaceHex, setSurfaceHex] = useState<Record<AppearanceSurface, string>>(() => {
    const palette = appearancePalette(state.effective)
    return Object.fromEntries(APPEARANCE_SURFACES.map(key => [key, state.preferences.value.colors?.[key] && state.preferences.value.colors[key] !== "auto" ? state.preferences.value.colors[key] : palette[key].background])) as Record<AppearanceSurface, string>
  })
  const [pending, setPending] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [imageStatus, setImageStatus] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const [applyAll, setApplyAll] = useState(false)
  const [targets, setTargets] = useState<AppearanceTarget[] | null>(null)
  const request = useRef<AbortController | null>(null)
  const preparation = useRef<AbortController | null>(null)
  const selectionGeneration = useRef(0)
  const processingRef = useRef(false)
  const generation = useRef(0)
  const preview = useMemo(() => visibleAppearance(draft, state), [draft, state])
  const selectedBackground = draft.background
  const backgroundMode = selectedBackground === null ? "inherit" : selectedBackground.kind
  const accentValue = draft.accent ?? state.author.accent
  const accentInherited = draft.role === "viewer" && draft.accent === null
  const invalidColor = (selectedBackground?.kind === "solid" && !parseHex(backgroundHex)) || (!accentInherited && !parseHex(accentHex)) || APPEARANCE_SURFACES.some(key => draft.colors?.[key] && draft.colors[key] !== "auto" && !parseHex(surfaceHex[key]))

  useEffect(() => { onPreview({ appearance: preview, previewUrl }) }, [preview, previewUrl, onPreview])
  useEffect(() => () => { generation.current++; request.current?.abort(); selectionGeneration.current++; preparation.current?.abort(); onPreview(null) }, [onPreview])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  function discardPreparation() {
    selectionGeneration.current++
    preparation.current?.abort()
    preparation.current = null
    processingRef.current = false
    setProcessing(false)
  }
  function close() { discardPreparation(); generation.current++; request.current?.abort(); onClose() }
  function setBackground(background: AppearanceChoice | null) {
    discardPreparation()
    setDraft(current => ({ ...current, background } as SaveAppearance["preferences"]))
    if (background?.kind !== "upload") { setFile(null); setPreviewUrl(undefined); setImageStatus("") }
  }
  function setAccent(accent: string | null) { setDraft(current => ({ ...current, accent } as SaveAppearance["preferences"])) }
  function setSurface(surface: AppearanceSurface, color: string | "auto" | undefined) {
    setDraft(current => {
      const colors: ViewerColors = { ...current.colors }
      if (color === undefined) delete colors[surface]
      else colors[surface] = color
      return { ...current, colors } as SaveAppearance["preferences"]
    })
  }
  function reset() {
    if (pending || refreshing) return
    discardPreparation()
    setDraft(draft.role === "author" ? { role: "author", ...DEFAULT_APPEARANCE, colors: {} } : { role: "viewer", background: null, accent: null, colors: {} })
    setFile(null); setPreviewUrl(undefined); setImageStatus(""); setError(""); setConflict(false)
    setBackgroundHex("#10243b"); setAccentHex(DEFAULT_APPEARANCE.accent)
    const palette = appearancePalette(DEFAULT_APPEARANCE)
    setSurfaceHex(Object.fromEntries(APPEARANCE_SURFACES.map(key => [key, palette[key].background])) as Record<AppearanceSurface, string>)
  }
  async function loadTargets(signal: AbortSignal) {
    const response = await fetch(`/api/boards/${boardId}/appearance?all=true`, { cache: "no-store", signal })
    const result = await response.json()
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not load boards")
    return result.targets as AppearanceTarget[]
  }
  async function toggleAll(checked: boolean) {
    setApplyAll(checked); setTargets(null); setError("")
    if (!checked) return
    const currentGeneration = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setRefreshing(true)
    try {
      const next = await loadTargets(controller.signal)
      if (currentGeneration !== generation.current) return
      setTargets(next)
      if (next.find(target => target.boardId === boardId)?.token !== baseToken) { setConflict(true); setError("Appearance changed on another device. Reload it or reapply your choices.") }
    } catch (cause) { if (currentGeneration === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load boards") }
    finally { if (currentGeneration === generation.current) setRefreshing(false) }
  }
  async function refresh(reapply: boolean) {
    if (!reapply) discardPreparation()
    const currentGeneration = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setRefreshing(true)
    try {
      const response = await fetch(`/api/boards/${boardId}/appearance`, { cache: "no-store", signal: controller.signal })
      if (!response.ok) throw new Error("Could not reload appearance")
      const latest = await response.json() as AppearanceState
      const nextTargets = applyAll ? await loadTargets(controller.signal) : null
      if (currentGeneration !== generation.current) return
      onBaseline(latest)
      setBaseToken(latest.token)
      setTargets(nextTargets)
      if (!reapply) { const palette = appearancePalette(latest.effective); setDraft(initialDraft(latest)); setFile(null); setPreviewUrl(undefined); setImageStatus(""); setAccentHex(latest.effective.accent); setBackgroundHex(latest.effective.background.kind === "solid" ? latest.effective.background.color : "#10243b"); setSurfaceHex(Object.fromEntries(APPEARANCE_SURFACES.map(key => [key, latest.preferences.value.colors?.[key] && latest.preferences.value.colors[key] !== "auto" ? latest.preferences.value.colors[key] : palette[key].background])) as Record<AppearanceSurface, string>) }
      setConflict(false); setError("")
    } catch (cause) { if (currentGeneration === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not reload appearance") }
    finally { if (currentGeneration === generation.current) setRefreshing(false) }
  }
  async function save() {
    if (pending || refreshing || processingRef.current || conflict || invalidColor || (applyAll && !targets)) return
    const currentGeneration = ++generation.current
    const controller = new AbortController()
    request.current = controller
    setPending(true); setError("")
    onSaving()
    const form = new FormData()
    form.set("preferences", JSON.stringify({ expectedToken: baseToken, preferences: draft, ...(applyAll && targets ? { targets } : {}) }))
    if (file) form.set("image", file)
    try {
      const response = await fetch(`/api/boards/${boardId}/appearance`, { method: "PUT", body: form, signal: controller.signal })
      const result = await response.json()
      if (currentGeneration !== generation.current) return
      if (response.status === 409) { setConflict(true); setError(applyAll ? "Board access or appearance changed. Reload or reapply your choices." : "Appearance changed on another device. Reload it or reapply your choices."); return }
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not save appearance")
      onSaved(result as AppearanceState)
    } catch (cause) {
      if (currentGeneration === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not save appearance")
    } finally { if (currentGeneration === generation.current) setPending(false) }
  }

  async function selectImage(chosen: File) {
    discardPreparation()
    const currentSelection = selectionGeneration.current
    const controller = new AbortController()
    preparation.current = controller
    processingRef.current = true
    setProcessing(true)
    setError("")
    try {
      const prepared = await prepareWallpaper(chosen, controller.signal)
      if (currentSelection !== selectionGeneration.current || controller.signal.aborted) return
      setFile(prepared.file)
      setPreviewUrl(URL.createObjectURL(prepared.file))
      setDraft(current => ({ ...current, background: { kind: "upload" } } as SaveAppearance["preferences"]))
      setImageStatus(`Image ready · ${imageSize(chosen.size)} → ${imageSize(prepared.file.size)} · ${prepared.width} × ${prepared.height}`)
    } catch (cause) {
      if (currentSelection === selectionGeneration.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Could not prepare image")
      }
    } finally {
      if (currentSelection === selectionGeneration.current) {
        preparation.current = null
        processingRef.current = false
        setProcessing(false)
      }
    }
  }

  return <Dialog open onOpenChange={open => { if (!open) close() }}>
    <DialogContent className="appearance-dialog" style={appearanceTokens(preview, boardId)}>
      <DialogHeader><DialogTitle>Appearance for {boardName}</DialogTitle><DialogDescription>{draft.role === "author" ? "Set the defaults for this board and its viewers." : "Your choices on this board are private to you."} Preview changes here, then save.</DialogDescription></DialogHeader>
      <div className="appearance-preview" style={{ background: appearanceBackground(preview.background, boardId, previewUrl) }} aria-label="Live board preview">
        <div className="appearance-preview-bar"><span>Dashboard</span><span className="appearance-preview-active">{draft.role === "author" ? "Edit layout" : "Customize my layout"}</span></div>
        <div className="appearance-preview-board-bar">Board toolbar <span>Boards</span></div>
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
          void selectImage(chosen)
        }} />
        <p>Choose a still JPEG, PNG, or WebP up to 50 MiB. Large images are automatically resized before saving.</p>
        {(processing || imageStatus) && <p role="status">{processing ? "Optimizing image…" : imageStatus}</p>}
      </fieldset>
      <fieldset className="appearance-fields" disabled={pending || refreshing}><legend>Accent</legend>
        {draft.role === "viewer" && <label><input type="checkbox" checked={accentInherited} onChange={event => { setAccent(event.target.checked ? null : state.author.accent); setAccentHex(state.author.accent) }} /> Use author&apos;s accent</label>}
        <div className="appearance-color"><input aria-label="Accent color picker" type="color" value={accentValue} disabled={accentInherited} onChange={event => { setAccentHex(event.target.value); setAccent(event.target.value) }} /><input aria-label="Accent hex color" aria-invalid={!accentInherited && !parseHex(accentHex)} value={accentInherited ? state.author.accent : accentHex} disabled={accentInherited} onChange={event => { setAccentHex(event.target.value); const color = parseHex(event.target.value); if (color) setAccent(color) }} /></div>
      </fieldset>
      <details className="appearance-advanced"><summary>Advanced</summary>
        <p>Set a custom background for each area. Automatic colors follow the accent.</p>
        <fieldset className="appearance-fields" disabled={pending || refreshing}><legend>Background colors</legend>
          {APPEARANCE_SURFACES.map(surface => {
            const choice = draft.colors?.[surface]
            const mode = choice === undefined ? draft.role === "viewer" ? "inherit" : "auto" : choice === "auto" ? "auto" : "custom"
            const label = SURFACE_LABELS[surface]
            return <div className="appearance-surface-row" key={surface}>
              <label htmlFor={`appearance-${surface}-mode`}>{label}</label>
              <select id={`appearance-${surface}-mode`} aria-label={`${label} color mode`} value={mode} onChange={event => {
                const selected = event.target.value
                if (selected === "inherit") setSurface(surface, undefined)
                else if (selected === "auto") setSurface(surface, draft.role === "viewer" ? "auto" : undefined)
                else { const color = appearancePalette(preview)[surface].background; setSurfaceHex(current => ({ ...current, [surface]: color })); setSurface(surface, color) }
              }}>
                {draft.role === "viewer" && <option value="inherit">Use author&apos;s choice</option>}
                <option value="auto">Automatic</option><option value="custom">Custom</option>
              </select>
              {mode === "custom" && <div className="appearance-color"><input aria-label={`${label} color picker`} type="color" value={parseHex(surfaceHex[surface]) ?? parseHex(choice) ?? "#000000"} onChange={event => { setSurfaceHex(current => ({ ...current, [surface]: event.target.value })); setSurface(surface, event.target.value) }} /><input aria-label={`${label} hex color`} aria-invalid={!parseHex(surfaceHex[surface])} value={surfaceHex[surface]} onChange={event => { setSurfaceHex(current => ({ ...current, [surface]: event.target.value })); const color = parseHex(event.target.value); if (color) setSurface(surface, color) }} /></div>}
            </div>
          })}
        </fieldset>
      </details>
      <div className="appearance-apply-all"><label><input type="checkbox" checked={applyAll} disabled={pending || refreshing} onChange={event => void toggleAll(event.target.checked)} /> Apply to all boards</label>
        {applyAll && <p>Updates defaults on your boards and your private choices on shared boards.{draft.role === "viewer" && (draft.background === null || draft.accent === null || APPEARANCE_SURFACES.some(surface => draft.colors?.[surface] === undefined)) && " Inherited fields leave your own boards unchanged."}</p>}
      </div>
      {invalidColor && <p role="alert" className="appearance-error">Enter a six-digit hex color such as #123abc.</p>}
      {error && <p role="alert" className="appearance-error">{error}</p>}
      {conflict && <div className="appearance-conflict"><Button variant="outline" disabled={refreshing} onClick={() => void refresh(false)}>Reload saved appearance</Button><Button variant="outline" disabled={refreshing} onClick={() => void refresh(true)}>Reapply my choices</Button></div>}
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="button" variant="outline" disabled={pending || refreshing} onClick={reset}>Reset</Button><Button type="button" disabled={pending || refreshing || processing || conflict || Boolean(invalidColor) || (applyAll && !targets)} onClick={() => void save()}>{pending ? "Saving…" : refreshing ? "Loading…" : "Save appearance"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
