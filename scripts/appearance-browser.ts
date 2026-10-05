import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, type BrowserContext, type Page } from "playwright"

const base = process.env.E2E_BASE_URL
const boardId = process.env.E2E_BOARD_ID
const otherBoardId = process.env.E2E_OTHER_BOARD_ID
const authorToken = process.env.E2E_AUTHOR_SESSION_TOKEN
const firstToken = process.env.E2E_FIRST_VIEWER_SESSION_TOKEN
const secondToken = process.env.E2E_SECOND_VIEWER_SESSION_TOKEN
const imageFixture = process.env.E2E_IMAGE_PATH
assert(base && boardId && otherBoardId && authorToken && firstToken && secondToken && imageFixture)
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
  assert.match(await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage), /blob:/)
  await author.screenshot({ path: resolve(screenshotDir, "author-image-preview-desktop.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Reset" }).click()
  await dialog.getByLabel("Choose background image").setInputFiles(imageFixture)
  assert.match(await dialog.locator(".appearance-preview").evaluate(element => getComputedStyle(element).backgroundImage), /blob:/, "Same file can be selected after reset")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  assert.equal(await boardBackground(author), original)
  dialog = await openSettings(author, "Author")
  await dialog.getByLabel("Choose background image").setInputFiles(imageFixture)
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
  await second.waitForFunction(() => getComputedStyle(document.querySelector(".dashboard-shell")!).backgroundColor === "rgb(17, 34, 51)", undefined, { timeout: 12000 })
  assert.match(await boardBackground(first), /appearance\/assets/, "First viewer keeps a personal image")
  await first.screenshot({ path: resolve(screenshotDir, "viewer-personal-desktop.png"), fullPage: true })
  await second.screenshot({ path: resolve(screenshotDir, "viewer-inherited-mobile.png"), fullPage: true })
  dialog = await openSettings(second, "Second")
  await dialog.getByRole("checkbox", { name: /Use author's accent/ }).uncheck()
  await dialog.getByRole("textbox", { name: "Accent hex color" }).fill("#ffcc00")
  await second.screenshot({ path: resolve(screenshotDir, "viewer-preview-mobile.png"), fullPage: true })
  await dialog.getByRole("button", { name: "Save appearance" }).click()
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
  console.log(`Appearance browser desktop/mobile, preview, reset, save, cancel, stalled close, playback: passed; screenshots ${screenshotDir}`)
} finally {
  for (const current of contexts) await current.close().catch(() => {})
  await browser.close().catch(() => {})
}
