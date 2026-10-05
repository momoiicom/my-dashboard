import assert from "node:assert/strict"
import { mkdir, readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, type BrowserContext, type Page } from "playwright"
import sharp from "sharp"
import type { AppearanceState } from "../lib/appearance"

const base = process.env.E2E_BASE_URL
const boardId = process.env.E2E_BOARD_ID
const otherBoardId = process.env.E2E_OTHER_BOARD_ID
const authorToken = process.env.E2E_AUTHOR_SESSION_TOKEN
const firstToken = process.env.E2E_FIRST_VIEWER_SESSION_TOKEN
const secondToken = process.env.E2E_SECOND_VIEWER_SESSION_TOKEN
const imageFixture = process.env.E2E_IMAGE_PATH
const largeImageFixture = process.env.E2E_LARGE_IMAGE_PATH
const rotatedImageFixture = process.env.E2E_ROTATED_IMAGE_PATH
const animatedImageFixture = process.env.E2E_ANIMATED_IMAGE_PATH
const animatedWebpFixture = process.env.E2E_ANIMATED_WEBP_PATH
assert(base && boardId && otherBoardId && authorToken && firstToken && secondToken && imageFixture && largeImageFixture && rotatedImageFixture && animatedImageFixture && animatedWebpFixture)
const screenshotDir = resolve(".e2e/appearance")
await mkdir(screenshotDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const contexts: BrowserContext[] = []
async function context(token: string, width: number, height: number) {
  const current = await browser.newContext({ baseURL: base, viewport: { width, height } })
  contexts.push(current)
  await current.addCookies([{ url: base, name: "next-auth.session-token", value: token, httpOnly: true, sameSite: "Lax", secure: false }])
  return current
}
async function closeOnboarding(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Connect your bot" })
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close" }).first().click()
}
async function openSettings(page: Page, person: string) {
  await page.getByRole("button", { name: `Account menu for ${person}` }).click()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog", { name: /Appearance for/ })
  await dialog.waitFor()
  return dialog
}
async function boardBackground(page: Page) { return page.locator(".dashboard-shell").evaluate(element => getComputedStyle(element).background) }
async function waitForPreparedImage(dialog: ReturnType<Page["getByRole"]>) { await dialog.getByRole("status").filter({ hasText: "Image ready" }).waitFor() }
async function contrast(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate(element => {
    const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(channel => {
      const normalized = channel / 255
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4
    })
    const luminance = (value: string) => { const [red, green, blue] = channels(value); return .2126 * red + .7152 * green + .0722 * blue }
    const style = getComputedStyle(element)
    const a = luminance(style.backgroundColor), b = luminance(style.color)
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
  })
}
async function surfaceContrast(locator: ReturnType<Page["locator"]>, backgroundSelector: string) {
  return locator.evaluate((element, selector) => {
    const background = element.closest(selector)
    if (!background) throw new Error(`Missing contrast surface ${selector}`)
    const luminance = (value: string) => {
      const [red, green, blue] = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(channel => {
        const value = channel / 255
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
      })
      return .2126 * red + .7152 * green + .0722 * blue
    }
    const first = luminance(getComputedStyle(element).color), second = luminance(getComputedStyle(background).backgroundColor)
    return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
  }, backgroundSelector)
}
async function toolbarBackgrounds(page: Page) {
  return page.evaluate(() => [".dashboard-topbar", ".board-toolbar"].map(selector => getComputedStyle(document.querySelector(selector)!).backgroundColor))
}
async function settleColors(locator: ReturnType<Page["locator"]>) {
  await locator.evaluate(async element => {
    void getComputedStyle(element).color
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished))
  })
}
try {
  const authorContext = await context(authorToken, 1440, 900)
  const firstContext = await context(firstToken, 1440, 900)
  const secondContext = await context(secondToken, 390, 844)
  const author = await authorContext.newPage(), first = await firstContext.newPage(), second = await secondContext.newPage()
  const boardPath = `/boards/${boardId}`
  await Promise.all([author.goto(boardPath), first.goto(boardPath), second.goto(boardPath)])
  await Promise.all([closeOnboarding(author), closeOnboarding(first), closeOnboarding(second)])
  for (const page of [author, first, second]) await page.getByRole("heading", { name: "Revenue" }).waitFor()
  assert.match(await boardBackground(author), /appearance\/assets/)
  assert.match(await boardBackground(first), /appearance\/assets/)
  assert.match(await boardBackground(second), /appearance\/assets/)
  const original = await boardBackground(author)
  let dialog = await openSettings(author, "Author")
  await dialog.getByLabel("Choose background image").setInputFiles(imageFixture)
  await waitForPreparedImage(dialog)
  assert.match(await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage), /blob:/)
  await author.screenshot({ path: resolve(screenshotDir, "author-image-preview-desktop.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Reset" }).click()
  await dialog.getByLabel("Choose background image").setInputFiles(imageFixture)
  await waitForPreparedImage(dialog)
  assert.match(await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage), /blob:/, "Same file can be selected after reset")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  assert.equal(await boardBackground(author), original)
  dialog = await openSettings(author, "Author")
  await dialog.getByLabel("Choose background image").setInputFiles(imageFixture)
  await waitForPreparedImage(dialog)
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  await author.reload()
  await author.getByRole("heading", { name: "Revenue" }).waitFor()
  const uploadedImage = await boardBackground(author)
  assert.match(uploadedImage, /appearance\/assets/)
  assert.notEqual(uploadedImage, original, "UI upload gets a new immutable asset URL")
  const assetUrl = uploadedImage.match(/\/api\/boards\/[^"')]+\/appearance\/assets\/a_[a-f0-9]{32}/)?.[0]
  assert(assetUrl)
  assert.equal((await author.request.get(assetUrl)).status(), 200)
  await author.screenshot({ path: resolve(screenshotDir, "author-uploaded-desktop.png"), fullPage: true })
  dialog = await openSettings(author, "Author")
  await dialog.getByRole("radio", { name: "Solid color" }).check()
  const backgroundHex = dialog.getByRole("textbox", { name: "Background hex color" })
  await backgroundHex.fill("")
  assert.equal(await dialog.getByRole("button", { name: "Save appearance" }).isDisabled(), true)
  await backgroundHex.pressSequentially("#fefefe")
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#ffffff")
  for (const color of ["#ffffff", "#000000", "#757575"]) {
    await dialog.getByRole("textbox", { name: "Accent hex color" }).fill(color)
    assert((await contrast(dialog.locator(".appearance-preview-active"))) >= 4.5, `Accent ${color} must keep a readable control label`)
  }
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#ffffff")
  assert.match(await boardBackground(author), /rgb\(254, 254, 254\)/)
  assert.equal(await dialog.getByRole("button", { name: "Save appearance" }).isEnabled(), true)
  await author.screenshot({ path: resolve(screenshotDir, "author-preview-desktop.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Cancel" }).click()
  assert.equal(await boardBackground(author), uploadedImage)
  dialog = await openSettings(author, "Author")
  await dialog.getByRole("radio", { name: "Solid color" }).check()
  await dialog.getByRole("textbox", { name: "Background hex color" }).fill("#112233")
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#f5e6be")
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.match(await boardBackground(author), /rgb\(17, 34, 51\)/)
  const editLayout = author.getByRole("button", { name: "Edit layout" })
  assert((await contrast(editLayout)) >= 4.5, "Saved light accent must keep its button label readable")
  await editLayout.click()
  const doneEditing = author.getByRole("button", { name: "Done editing" })
  assert((await contrast(doneEditing)) >= 4.5, "Pressed control must keep its label readable")
  await doneEditing.click()
  await author.screenshot({ path: resolve(screenshotDir, "author-saved-desktop.png"), fullPage: true })
  dialog = await openSettings(author, "Author")
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#000000")
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  const blackEdit = author.getByRole("button", { name: "Edit layout" })
  assert((await contrast(blackEdit)) >= 4.5)
  await blackEdit.click()
  assert.equal(await author.locator(".react-resizable-handle").first().evaluate(element => getComputedStyle(element, "::after").borderRightColor), "rgb(255, 255, 255)")
  await author.screenshot({ path: resolve(screenshotDir, "author-black-edit-desktop.png"), fullPage: true })
  await author.getByRole("button", { name: "Done editing" }).click()
  dialog = await openSettings(author, "Author")
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#f5e6be")
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  const currentViewerAppearance = await (await second.request.get(`/api/boards/${boardId}/appearance`)).json() as AppearanceState
  const viewerSnapshot = await second.waitForResponse(async response => {
    if (!response.url().endsWith(`/api/boards/${boardId}/cards`) || response.request().method() !== "GET" || !response.ok()) return false
    const snapshot = await response.json() as { appearance: AppearanceState }
    return snapshot.appearance.token === currentViewerAppearance.token
  })
  await viewerSnapshot.finished()
  await second.waitForFunction(() => getComputedStyle(document.querySelector(".dashboard-shell")!).backgroundColor === "rgb(17, 34, 51)", undefined, { timeout: 12000 })
  assert.match(await boardBackground(first), /appearance\/assets/, "First viewer keeps a personal image")
  await first.screenshot({ path: resolve(screenshotDir, "viewer-personal-desktop.png"), fullPage: true })
  await second.screenshot({ path: resolve(screenshotDir, "viewer-inherited-mobile.png"), fullPage: true })
  dialog = await openSettings(second, "Second")
  await dialog.getByRole("checkbox", { name: /Use author's accent/ }).uncheck()
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#ffcc00")
  await second.screenshot({ path: resolve(screenshotDir, "viewer-preview-mobile.png"), fullPage: true })
  const viewerSave = second.waitForResponse(response => response.url().endsWith(`/api/boards/${boardId}/appearance`) && response.request().method() === "PUT")
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  const viewerResponse = await viewerSave
  assert.equal(viewerResponse.status(), 200, "Saving a viewer override after the latest appearance snapshot must succeed")
  await dialog.waitFor({ state: "hidden" })
  await second.reload()
  await second.getByRole("heading", { name: "Revenue" }).waitFor()
  dialog = await openSettings(second, "Second")
  assert.equal(await dialog.getByRole("textbox", { name: "Accent hex color" }).inputValue(), "#ffcc00")
  await dialog.getByRole("button", { name: "Reset" }).click()
  assert.equal(await dialog.getByRole("checkbox", { name: /Use author's accent/ }).isChecked(), true)
  await dialog.getByRole("button", { name: "Cancel" }).click()
  dialog = await openSettings(second, "Second")
  assert.equal(await dialog.getByRole("textbox", { name: "Accent hex color" }).inputValue(), "#ffcc00", "Cancel keeps the saved override")
  await dialog.getByRole("button", { name: "Reset" }).click()
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  const effective = await (await second.request.get(`/api/boards/${boardId}/appearance`)).json() as { source: { accent: string } }
  assert.equal(effective.source.accent, "author")
  assert((await contrast(author.getByRole("button", { name: "Edit layout" }))) >= 4.5)
  async function remoteAccent(accent: string) {
    const current = await (await author.request.get(`/api/boards/${boardId}/appearance`)).json() as { token: string; author: { background: unknown } }
    const response = await author.request.put(`/api/boards/${boardId}/appearance`, { headers: { origin: base! }, multipart: { preferences: JSON.stringify({ expectedToken: current.token, preferences: { role: "author", background: current.author.background, accent } }) } })
    assert.equal(response.status(), 200, await response.text())
  }
  dialog = await openSettings(author, "Author")
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#778899")
  await remoteAccent("#334455")
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.getByText("Appearance changed on another device", { exact: false }).waitFor()
  assert.equal(await dialog.getByRole("textbox", { name: "Accent hex color" }).inputValue(), "#778899", "Conflict keeps the draft")
  await dialog.getByRole("button", { name: "Reapply my choices" }).click()
  await dialog.getByRole("button", { name: "Reapply my choices" }).waitFor({ state: "hidden" })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal((await (await author.request.get(`/api/boards/${boardId}/appearance`)).json()).effective.accent, "#778899")
  dialog = await openSettings(author, "Author")
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#223344")
  await remoteAccent("#445566")
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.getByText("Appearance changed on another device", { exact: false }).waitFor()
  let reloadArrived!: () => void, releaseReload!: () => void
  const reloadWaiting = new Promise<void>(resolve => { reloadArrived = resolve })
  const blockedReload = new Promise<void>(resolve => { releaseReload = resolve })
  await author.route(`**/api/boards/${boardId}/appearance`, async route => {
    if (route.request().method() !== "GET") { await route.continue(); return }
    reloadArrived(); await blockedReload; await route.abort().catch(() => {})
  })
  await dialog.getByRole("button", { name: "Reload saved appearance" }).click()
  await reloadWaiting
  assert.equal(await dialog.getByRole("button", { name: "Reset" }).isDisabled(), true)
  assert.equal(await dialog.getByRole("button", { name: "Cancel" }).isEnabled(), true)
  await author.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden", timeout: 1500 })
  releaseReload()
  await author.unroute(`**/api/boards/${boardId}/appearance`)
  await author.reload()
  await author.getByRole("heading", { name: "Revenue" }).waitFor()
  dialog = await openSettings(author, "Author")
  assert.equal(await dialog.getByRole("textbox", { name: "Accent hex color" }).inputValue(), "#445566")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  dialog = await openSettings(author, "Author")
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#000000")
  let arrived!: () => void, release!: () => void
  const waiting = new Promise<void>(resolve => { arrived = resolve })
  const stalled = new Promise<void>(resolve => { release = resolve })
  await author.route(`**/api/boards/${boardId}/appearance`, async route => {
    if (route.request().method() !== "PUT") { await route.continue(); return }
    arrived(); await stalled; await route.abort().catch(() => {})
  })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await waiting
  assert.equal(await dialog.getByRole("button", { name: "Reset" }).isDisabled(), true)
  await author.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden", timeout: 1500 })
  release()
  await author.unroute(`**/api/boards/${boardId}/appearance`)
  assert.match(await boardBackground(author), /rgb\(17, 34, 51\)/)
  await author.bringToFront()
  await author.getByRole("button", { name: "Play slideshow" }).click()
  const stage = author.locator(".presentation-stage")
  await stage.waitFor()
  await author.screenshot({ path: resolve(screenshotDir, "slideshow-first-desktop.png"), fullPage: true })
  const firstPanel = author.locator(`.presentation-panel[data-board-id="${boardId}"]`)
  assert.equal(await firstPanel.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(17, 34, 51)")
  const otherPanel = author.locator(`.presentation-panel[data-board-id="${otherBoardId}"]`)
  await otherPanel.waitFor({ timeout: 20000 })
  assert.equal(await otherPanel.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(241, 211, 161)")
  const transitionColors = await author.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const stage = document.querySelector(".presentation-stage")!
    const colors = () => [...stage.querySelectorAll(".presentation-panel")].map(element => getComputedStyle(element).backgroundColor)
    if (stage.getAttribute("data-phase") === "sliding") { resolve(colors()); return }
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error("Slideshow did not advance")) }, 65000)
    const observer = new MutationObserver(() => {
      if (stage.getAttribute("data-phase") !== "sliding") return
      clearTimeout(timer); observer.disconnect(); resolve(colors())
    })
    observer.observe(stage, { attributes: true, attributeFilter: ["data-phase"] })
  }))
  assert(transitionColors.includes("rgb(17, 34, 51)"))
  assert(transitionColors.includes("rgb(241, 211, 161)"))
  assert.equal(await firstPanel.count(), 1)
  assert.equal(await otherPanel.count(), 1)
  await author.screenshot({ path: resolve(screenshotDir, "slideshow-transition-desktop.png"), fullPage: true })
  await author.waitForFunction(id => document.querySelector(".presentation-stage")?.getAttribute("data-phase") === "dwelling" && document.querySelector(".presentation-panel:not(.presentation-preloaded)")?.getAttribute("data-board-id") === id, otherBoardId, { timeout: 20000 })
  await author.screenshot({ path: resolve(screenshotDir, "slideshow-second-desktop.png"), fullPage: true })
  await author.mouse.move(100, 100)
  await author.getByRole("button", { name: "Stop slideshow" }).click()
  await second.bringToFront()
  await second.getByRole("button", { name: "Play slideshow" }).click()
  await second.locator(".presentation-stage").waitFor()
  await second.screenshot({ path: resolve(screenshotDir, "slideshow-mobile.png"), fullPage: true })
  await second.mouse.move(100, 100)
  await second.getByRole("button", { name: "Stop slideshow" }).click()
  await author.goto(boardPath)
  await author.getByRole("heading", { name: "Revenue" }).waitFor()
  const otherBeforeAll = await (await author.request.get(`/api/boards/${otherBoardId}/appearance`)).json() as AppearanceState
  dialog = await openSettings(author, "Author")
  assert.equal(await dialog.getByRole("checkbox", { name: "Apply to all boards", exact: true }).isChecked(), false)
  await dialog.getByRole("radio", { name: "Solid color" }).check()
  await dialog.getByRole("textbox", { name: "Background hex color" }).fill("#314159")
  await dialog.getByRole("checkbox", { name: "Apply to all boards", exact: true }).check()
  await dialog.getByRole("button", { name: "Save appearance" }).waitFor()
  assert.deepEqual(await (await author.request.get(`/api/boards/${otherBoardId}/appearance`)).json(), otherBeforeAll, "Checking all boards is only a draft")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  assert.deepEqual(await (await author.request.get(`/api/boards/${otherBoardId}/appearance`)).json(), otherBeforeAll, "Cancelling leaves every other board unchanged")
  dialog = await openSettings(author, "Author")
  assert.equal(await dialog.getByRole("checkbox", { name: "Apply to all boards", exact: true }).isChecked(), false)
  await dialog.getByLabel("Choose background image").setInputFiles(imageFixture)
  await waitForPreparedImage(dialog)
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#271828")
  await dialog.getByRole("checkbox", { name: "Apply to all boards", exact: true }).check()
  await dialog.getByRole("button", { name: "Save appearance" }).waitFor()
  await author.screenshot({ path: resolve(screenshotDir, "apply-all-desktop.png"), fullPage: true })
  const concurrent = await author.request.put(`/api/boards/${otherBoardId}/appearance`, { headers: { origin: base! }, multipart: { preferences: JSON.stringify({ expectedToken: otherBeforeAll.token, preferences: { role: "author", background: otherBeforeAll.author.background, accent: "#010203" } }) } })
  assert.equal(concurrent.status(), 200)
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.getByText("Board access or appearance changed", { exact: false }).waitFor()
  await dialog.getByRole("button", { name: "Reapply my choices" }).click()
  await dialog.getByRole("button", { name: "Reapply my choices" }).waitFor({ state: "hidden" })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  const authorAll = await (await author.request.get(`/api/boards/${boardId}/appearance`)).json() as AppearanceState
  const otherAll = await (await author.request.get(`/api/boards/${otherBoardId}/appearance`)).json() as AppearanceState
  assert.equal(authorAll.effective.accent, "#271828")
  assert.equal(otherAll.effective.accent, "#271828")
  assert.equal(authorAll.effective.background.kind, "image")
  assert.equal(otherAll.effective.background.kind, "image")
  await author.goto(`/boards/${otherBoardId}`)
  assert.match(await boardBackground(author), /appearance\/assets/)
  await second.goto(boardPath)
  await second.getByRole("heading", { name: "Revenue" }).waitFor()
  dialog = await openSettings(second, "Second")
  await dialog.getByRole("radio", { name: "Solid color" }).check()
  await dialog.getByRole("textbox", { name: "Background hex color" }).fill("#abcdef")
  await dialog.getByRole("checkbox", { name: /Use author's accent/ }).uncheck()
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#100001")
  await dialog.getByRole("checkbox", { name: "Apply to all boards", exact: true }).check()
  await dialog.getByRole("button", { name: "Save appearance" }).waitFor()
  await second.screenshot({ path: resolve(screenshotDir, "apply-all-mobile.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  const personalAll = await (await second.request.get(`/api/boards/${boardId}/appearance`)).json() as AppearanceState
  assert.deepEqual(personalAll.effective, { background: { kind: "solid", color: "#abcdef" }, accent: "#100001" })
  const secondWorkspace = await (await second.request.get("/api/boards")).json() as { originalBoardId: string }
  const secondOwn = await (await second.request.get(`/api/boards/${secondWorkspace.originalBoardId}/appearance`)).json() as AppearanceState
  assert.deepEqual(secondOwn.effective, personalAll.effective)
  assert.deepEqual(await (await author.request.get(`/api/boards/${boardId}/appearance`)).json(), authorAll, "Viewer's apply all keeps shared author defaults unchanged")
  await author.goto(boardPath)
  await author.getByRole("heading", { name: "Revenue" }).waitFor()
  const wallpaperUploads: Buffer[] = []
  author.on("request", request => {
    if (request.method() === "PUT" && request.url() === `${base}/api/boards/${boardId}/appearance`) wallpaperUploads.push(request.postDataBuffer()!)
  })
  dialog = await openSettings(author, "Author")
  await dialog.getByLabel("Choose background image").setInputFiles(largeImageFixture)
  await waitForPreparedImage(dialog)
  assert.equal(wallpaperUploads.length, 0, "Preparing a large photo does not upload it")
  assert.match(await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage), /blob:/)
  await author.screenshot({ path: resolve(screenshotDir, "optimized-wallpaper-desktop.png"), fullPage: true })
  await author.evaluate(() => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      if (init?.method === "PUT" && init.body instanceof FormData) {
        const file = init.body.get("image")
        if (file instanceof File) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
          Object.assign(window, { wallpaperSubmitted: { size: file.size, type: file.type, dataUrl } })
        }
      }
      return original(input, init)
    }
    Object.assign(window, { wallpaperRestoreFetch: () => { window.fetch = original } })
  })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  const transmitted = await author.evaluate(() => (window as unknown as Window & { wallpaperSubmitted: { size: number; type: string; dataUrl: string } }).wallpaperSubmitted)
  await author.evaluate(() => (window as unknown as Window & { wallpaperRestoreFetch: () => void }).wallpaperRestoreFetch())
  assert(transmitted.size < 10 * 1024 * 1024 && transmitted.size < (await stat(largeImageFixture)).size, "PUT contains the reduced image, not the oversized original")
  const transmittedMetadata = await sharp(Buffer.from(transmitted.dataUrl.split(",")[1], "base64")).metadata()
  assert.equal(transmitted.type, "image/webp")
  assert.equal(transmittedMetadata.format, "webp")
  assert.equal(transmittedMetadata.width, 4096)
  assert.equal(transmittedMetadata.height, 2731)
  assert.equal(transmittedMetadata.exif, undefined)
  const optimizedState = await (await author.request.get(`/api/boards/${boardId}/appearance`)).json() as AppearanceState
  assert.equal(optimizedState.effective.background.kind, "image")
  if (optimizedState.effective.background.kind !== "image") throw new Error("Expected optimized wallpaper")
  const stored = await author.request.get(`/api/boards/${boardId}/appearance/assets/${optimizedState.effective.background.assetId}`)
  const storedMetadata = await sharp(await stored.body()).metadata()
  assert.equal(storedMetadata.width, 4096)
  assert.equal(storedMetadata.height, 2731)
  dialog = await openSettings(author, "Author")
  await dialog.getByLabel("Choose background image").setInputFiles(rotatedImageFixture)
  await waitForPreparedImage(dialog)
  const validPreview = await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage)
  const uploadsBeforeInvalid = wallpaperUploads.length
  for (const animatedFixture of [animatedImageFixture, animatedWebpFixture]) {
    await dialog.getByLabel("Choose background image").setInputFiles(animatedFixture)
    await dialog.getByRole("alert").filter({ hasText: /still|animated/i }).waitFor()
    assert.equal(await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage), validPreview, "Rejected animation keeps the prior valid photo")
  }
  const oversizedDimensions = await readFile(imageFixture)
  oversizedDimensions.writeUInt32BE(10000, 16)
  oversizedDimensions.writeUInt32BE(10000, 20)
  await dialog.getByLabel("Choose background image").setInputFiles({ name: "huge-dimensions.png", mimeType: "image/png", buffer: oversizedDimensions })
  await dialog.getByRole("alert").filter({ hasText: "50 million pixels" }).waitFor()
  await dialog.getByLabel("Choose background image").evaluate(input => {
    const files = new DataTransfer()
    files.items.add(new File([new Uint8Array(50 * 1024 * 1024 + 1)], "too-large.png", { type: "image/png" }))
    const picker = input as HTMLInputElement
    picker.files = files.files
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await dialog.getByRole("alert").filter({ hasText: "at most 50 MiB" }).waitFor()
  assert.equal(await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage), validPreview, "Oversized sources cannot replace a valid preview")
  assert.equal(wallpaperUploads.length, uploadsBeforeInvalid)
  await author.screenshot({ path: resolve(screenshotDir, "rotated-wallpaper-desktop.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  const rotatedState = await (await author.request.get(`/api/boards/${boardId}/appearance`)).json() as AppearanceState
  if (rotatedState.effective.background.kind !== "image") throw new Error("Expected rotated wallpaper")
  const rotatedBytes = await (await author.request.get(`/api/boards/${boardId}/appearance/assets/${rotatedState.effective.background.assetId}`)).body()
  const rotatedMetadata = await sharp(rotatedBytes).metadata()
  assert.equal(rotatedMetadata.width, 800)
  assert.equal(rotatedMetadata.height, 1200)
  const top = await sharp(rotatedBytes).extract({ left: 400, top: 100, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
  const bottom = await sharp(rotatedBytes).extract({ left: 400, top: 1100, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
  assert(top[0] > 200 && top[2] < 30 && bottom[2] > 200 && bottom[0] < 30, "EXIF rotation preserves the actual top and bottom of the photograph")
  await author.evaluate(() => {
    const original = window.createImageBitmap.bind(window)
    let release = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      const bitmap = await original(...args)
      await gate
      Object.assign(window, { wallpaperDecodeSettled: true })
      return bitmap
    }) as typeof createImageBitmap
    Object.assign(window, { wallpaperRelease: release, wallpaperRestore: () => { window.createImageBitmap = original } })
  })
  dialog = await openSettings(author, "Author")
  await dialog.getByLabel("Choose background image").setInputFiles(imageFixture)
  await dialog.getByRole("status").filter({ hasText: "Optimizing image" }).waitFor()
  assert.equal(await dialog.getByRole("button", { name: "Save appearance" }).isDisabled(), true)
  await dialog.getByRole("button", { name: "Reset" }).click()
  await author.evaluate(() => (window as unknown as Window & { wallpaperRelease: () => void }).wallpaperRelease())
  await author.waitForFunction(() => (window as Window & { wallpaperDecodeSettled?: boolean }).wallpaperDecodeSettled)
  await author.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  assert.doesNotMatch(await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage), /blob:/, "Reset cannot be overwritten by a late optimization")
  assert.equal(await dialog.getByRole("status").count(), 0)
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await author.evaluate(() => (window as unknown as Window & { wallpaperRestore: () => void }).wallpaperRestore())
  await second.goto(boardPath)
  await second.getByRole("heading", { name: "Revenue" }).waitFor()
  dialog = await openSettings(second, "Second")
  await dialog.getByLabel("Choose background image").setInputFiles(rotatedImageFixture)
  await waitForPreparedImage(dialog)
  await second.screenshot({ path: resolve(screenshotDir, "optimized-wallpaper-mobile.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Cancel" }).click()
  await author.goto(boardPath)
  await author.getByRole("heading", { name: "Revenue" }).waitFor()
  const savedToolbars = await toolbarBackgrounds(author)
  dialog = await openSettings(author, "Author")
  assert.equal(await dialog.locator("details").getAttribute("open"), null, "Advanced stays collapsed by default")
  let priorToolbars = savedToolbars
  for (const accent of ["#ffffff", "#000000", "#757575", "#ff0000", "#00ff00", "#0000ff"]) {
    await dialog.getByRole("textbox", { name: "Accent hex color" }).fill(accent)
    await author.waitForFunction(color => document.querySelector<HTMLElement>(".dashboard-shell")?.style.getPropertyValue("--board-accent") === color, accent)
    const colors = await toolbarBackgrounds(author)
    assert.notEqual(colors[0], priorToolbars[0], "The main toolbar responds to every accent change")
    assert.notEqual(colors[1], priorToolbars[1], "The board toolbar responds to every accent change")
    assert.notEqual(colors[0], colors[1], "The two toolbar bands keep distinct tones")
    assert.equal(await dialog.locator(".appearance-preview-bar").evaluate(element => getComputedStyle(element).backgroundColor), colors[0])
    assert.equal(await dialog.locator(".appearance-preview-board-bar").evaluate(element => getComputedStyle(element).backgroundColor), colors[1])
    assert(await surfaceContrast(author.locator(".dashboard-brand h1"), ".dashboard-topbar") >= 4.5)
    assert(await surfaceContrast(author.locator(".dashboard-account-trigger"), ".dashboard-topbar") >= 4.5)
    assert(await surfaceContrast(author.getByRole("tab", { name: "Other", exact: true, includeHidden: true }), ".board-toolbar") >= 4.5)
    assert(await surfaceContrast(author.getByRole("button", { name: "Play slideshow", includeHidden: true }), ".board-toolbar") >= 3)
    priorToolbars = colors
  }
  await author.screenshot({ path: resolve(screenshotDir, "automatic-accent-toolbars-desktop.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Cancel" }).click()
  assert.deepEqual(await toolbarBackgrounds(author), savedToolbars, "Cancel restores both saved toolbar colors")
  dialog = await openSettings(author, "Author")
  await dialog.locator("summary").filter({ hasText: "Advanced" }).click()
  const manualPalette = { mainToolbar: "#ffffff", boardToolbar: "#eeeeee", card: "#fefefe", button: "#000000" }
  for (const [label, color] of [["Main toolbar", manualPalette.mainToolbar], ["Board toolbar", manualPalette.boardToolbar], ["Cards", manualPalette.card], ["Buttons", manualPalette.button]]) {
    await dialog.getByLabel(`${label} color mode`, { exact: true }).selectOption("custom")
    await dialog.getByRole("textbox", { name: `${label} hex color`, exact: true }).fill(color)
  }
  assert.deepEqual(await toolbarBackgrounds(author), ["rgb(255, 255, 255)", "rgb(238, 238, 238)"])
  const revenueCard = author.locator(".dashboard-card-inner").filter({ has: author.getByRole("heading", { name: "Revenue", includeHidden: true }) })
  assert.equal(await revenueCard.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(254, 254, 254)")
  await author.waitForFunction(() => getComputedStyle(document.querySelector<HTMLElement>(".dashboard-actions [data-slot='button'][aria-pressed]")!).backgroundColor === "rgb(0, 0, 0)")
  await settleColors(revenueCard)
  assert.equal(await author.getByRole("button", { name: "Edit layout", exact: true, includeHidden: true }).evaluate(element => getComputedStyle(element).backgroundColor), "rgb(0, 0, 0)")
  for (const item of [author.getByRole("heading", { name: "Revenue", includeHidden: true }), revenueCard.locator(".bot-paragraph"), revenueCard.locator(".bot-provenance"), revenueCard.getByRole("columnheader", { includeHidden: true }).first(), revenueCard.getByRole("link", { name: "Report source", includeHidden: true })]) assert(await surfaceContrast(item, ".dashboard-card-inner") >= 4.5, "Card text and links stay readable on custom light cards")
  assert(await contrast(revenueCard.locator(".bot-richtext pre")) >= 4.5)
  assert(await contrast(revenueCard.locator(".bot-status-success")) >= 4.5)
  assert(await contrast(revenueCard.locator(".bot-status-warning")) >= 4.5)
  assert(await surfaceContrast(author.locator(".dashboard-brand h1"), ".dashboard-topbar") >= 4.5)
  assert(await surfaceContrast(author.locator(".dashboard-account-trigger"), ".dashboard-topbar") >= 4.5)
  for (const shade of ["#757575", "#858585"]) {
    for (const label of ["Main toolbar", "Board toolbar", "Cards", "Buttons"]) await dialog.getByRole("textbox", { name: `${label} hex color`, exact: true }).fill(shade)
    await author.waitForFunction(color => {
      const channel = parseInt(color.slice(1, 3), 16)
      return getComputedStyle(document.querySelector<HTMLElement>(".dashboard-actions [data-slot='button'][aria-pressed]")!).backgroundColor === `rgb(${channel}, ${channel}, ${channel})`
    }, shade)
    await settleColors(revenueCard)
    assert(await surfaceContrast(author.locator(".dashboard-brand h1"), ".dashboard-topbar") >= 4.5, "Mid-gray toolbar heading remains readable")
    assert(await surfaceContrast(author.locator(".dashboard-account-trigger"), ".dashboard-topbar") >= 4.5, "Mid-gray toolbar secondary text remains readable")
    assert(await surfaceContrast(author.getByRole("tab", { name: "Other", exact: true, includeHidden: true }), ".board-toolbar") >= 4.5)
    for (const item of [author.getByRole("heading", { name: "Revenue", includeHidden: true }), revenueCard.locator(".bot-paragraph"), revenueCard.locator(".bot-provenance"), revenueCard.getByRole("columnheader", { includeHidden: true }).first(), revenueCard.getByRole("link", { name: "Report source", includeHidden: true })]) assert(await surfaceContrast(item, ".dashboard-card-inner") >= 4.5, "Mid-gray cards retain readable primary, muted and link text")
    assert(await contrast(revenueCard.locator(".bot-richtext pre")) >= 4.5)
    assert(await contrast(revenueCard.locator(".bot-status-success")) >= 4.5)
    assert(await contrast(revenueCard.locator(".bot-status-warning")) >= 4.5)
    assert(await contrast(author.getByRole("button", { name: "Edit layout", exact: true, includeHidden: true })) >= 4.5)
  }
  for (const [label, color] of [["Main toolbar", manualPalette.mainToolbar], ["Board toolbar", manualPalette.boardToolbar], ["Cards", manualPalette.card], ["Buttons", manualPalette.button]]) await dialog.getByRole("textbox", { name: `${label} hex color`, exact: true }).fill(color)
  await dialog.getByRole("textbox", { name: "Cards hex color" }).fill("#broken")
  await dialog.locator("summary").filter({ hasText: "Advanced" }).click()
  assert.equal(await dialog.getByRole("button", { name: "Save appearance" }).isDisabled(), true, "Invalid custom color blocks Save even when Advanced collapses")
  assert.equal(await revenueCard.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(254, 254, 254)")
  await dialog.locator("summary").filter({ hasText: "Advanced" }).click()
  await dialog.getByRole("textbox", { name: "Cards hex color" }).fill(manualPalette.card)
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#00ff00")
  assert.deepEqual(await toolbarBackgrounds(author), ["rgb(255, 255, 255)", "rgb(238, 238, 238)"], "Manual toolbar backgrounds survive accent changes")
  await dialog.getByRole("button", { name: "Save appearance" }).scrollIntoViewIfNeeded()
  await author.screenshot({ path: resolve(screenshotDir, "advanced-colors-desktop.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  await author.reload()
  await author.getByRole("heading", { name: "Revenue" }).waitFor()
  const savedManual = await (await author.request.get(`/api/boards/${boardId}/appearance`)).json() as AppearanceState
  assert.deepEqual(savedManual.effective.colors, manualPalette)
  assert.deepEqual(await toolbarBackgrounds(author), ["rgb(255, 255, 255)", "rgb(238, 238, 238)"])
  await revenueCard.hover()
  assert.equal(await revenueCard.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(254, 254, 254)", "Hover does not replace a manual card background")
  await author.getByRole("button", { name: "Play slideshow" }).click()
  const presentationCard = author.locator(".presentation-panel:not(.presentation-preloaded) .dashboard-card-inner").filter({ has: author.getByRole("heading", { name: "Revenue" }) })
  await presentationCard.waitFor()
  assert.equal(await presentationCard.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(254, 254, 254)")
  assert(await surfaceContrast(presentationCard.getByRole("heading", { name: "Revenue" }), ".dashboard-card-inner") >= 4.5)
  await author.screenshot({ path: resolve(screenshotDir, "advanced-colors-slideshow.png"), fullPage: true })
  await author.mouse.move(100, 100)
  await author.getByRole("button", { name: "Stop slideshow" }).click()
  await second.goto(boardPath)
  await second.getByRole("heading", { name: "Revenue" }).waitFor()
  assert.deepEqual(await toolbarBackgrounds(second), ["rgb(255, 255, 255)", "rgb(238, 238, 238)"], "Viewer inherits the author's manual toolbar backgrounds")
  const sharedBadge = second.locator(".board-shared-badge")
  const sharedColor = await sharedBadge.evaluate(element => getComputedStyle(element).borderColor)
  dialog = await openSettings(second, "Second")
  await dialog.locator("summary").filter({ hasText: "Advanced" }).click()
  await dialog.getByLabel("Main toolbar color mode", { exact: true }).selectOption("auto")
  await dialog.getByLabel("Cards color mode", { exact: true }).selectOption("custom")
  await dialog.getByRole("textbox", { name: "Cards hex color", exact: true }).fill("#123456")
  await dialog.getByRole("checkbox", { name: "Apply to all boards", exact: true }).check()
  await second.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('.appearance-dialog button')].some(button => button.textContent === "Save appearance" && !button.disabled))
  await dialog.getByRole("button", { name: "Save appearance" }).scrollIntoViewIfNeeded()
  await second.screenshot({ path: resolve(screenshotDir, "advanced-colors-mobile.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  await second.reload()
  await second.getByRole("heading", { name: "Revenue" }).waitFor()
  const secondColors = await (await second.request.get(`/api/boards/${boardId}/appearance`)).json() as AppearanceState
  assert.deepEqual(secondColors.preferences.value.colors, { mainToolbar: "auto", card: "#123456" })
  assert.deepEqual(secondColors.effective.colors, { boardToolbar: "#eeeeee", card: "#123456", button: "#000000" })
  assert.equal(await sharedBadge.evaluate(element => getComputedStyle(element).borderColor), sharedColor, "Advanced colors preserve the Shared badge")
  assert.deepEqual(await (await author.request.get(`/api/boards/${boardId}/appearance`)).json(), savedManual, "Viewer advanced colors stay private")
  dialog = await openSettings(second, "Second")
  await dialog.getByRole("button", { name: "Reset" }).click()
  await second.waitForFunction(() => document.querySelector<HTMLElement>(".dashboard-shell")?.style.getPropertyValue("--board-main-toolbar-bg") === "#ffffff")
  assert.deepEqual(await toolbarBackgrounds(second), ["rgb(255, 255, 255)", "rgb(238, 238, 238)"])
  await dialog.getByRole("button", { name: "Save appearance" }).click()
  await dialog.waitFor({ state: "hidden" })
  const resetColors = await (await second.request.get(`/api/boards/${boardId}/appearance`)).json() as AppearanceState
  assert.equal(resetColors.preferences.value.colors, undefined)
  assert.deepEqual(resetColors.effective.colors, manualPalette)
  console.log("Automatic toolbar tinting and Advanced manual colors, readable light cards, preview/save/reload, private inheritance/reset and slideshow: passed")
  console.log(`Wallpaper browser optimization, reduced multipart upload, EXIF orientation, still-image validation and late reset: passed; source ${(await stat(largeImageFixture)).size} bytes, upload ${transmitted.size} bytes`)
  console.log(`Appearance browser desktop/mobile, preview, reset, save, cancel, stalled close, playback: passed; screenshots ${screenshotDir}`)
} finally {
  for (const current of contexts) await current.close().catch(() => {})
  await browser.close().catch(() => {})
}
