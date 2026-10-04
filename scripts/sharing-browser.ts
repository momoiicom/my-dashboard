import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, type BrowserContext, type Page } from "playwright"

const base = process.env.E2E_BASE_URL
const authorToken = process.env.E2E_AUTHOR_SESSION_TOKEN
const firstToken = process.env.E2E_FIRST_VIEWER_SESSION_TOKEN
const secondToken = process.env.E2E_SECOND_VIEWER_SESSION_TOKEN
assert(base && authorToken && firstToken && secondToken, "Set E2E_BASE_URL and three signed session tokens")
const screenshotDir = resolve(process.env.E2E_SCREENSHOT_DIR ?? ".e2e/sharing")
await mkdir(screenshotDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const contexts: BrowserContext[] = []
async function context(token: string, width: number, height: number) {
  const current = await browser.newContext({ baseURL: base, viewport: { width, height } })
  contexts.push(current)
  await current.addCookies([{ url: base, name: "next-auth.session-token", value: token, httpOnly: true, sameSite: "Lax", secure: false }])
  return current
}
const payload = (data: unknown) => ({ data, headers: { origin: base } })
async function createBoard(page: Page) {
  const response = await page.request.post("/api/boards", payload({ name: "Shared browser check" }))
  assert.equal(response.status(), 201)
  return ((await response.json()) as { board: { id: string } }).board.id
}
async function invite(page: Page, boardId: string, email: string) {
  const response = await page.request.post(`/api/boards/${boardId}/shares`, payload({ email }))
  assert([200, 201].includes(response.status()))
  return ((await response.json()) as { share: { id: string } }).share.id
}
async function closeOnboarding(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Connect your bot" })
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close" }).first().click()
}
try {
  const authorContext = await context(authorToken, 1440, 900)
  const firstContext = await context(firstToken, 1440, 900)
  const secondContext = await context(secondToken, 390, 844)
  const author = await authorContext.newPage()
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  const firstEmail = process.env.E2E_FIRST_VIEWER_EMAIL
  const secondEmail = process.env.E2E_SECOND_VIEWER_EMAIL
  assert(firstEmail && secondEmail, "Set viewer emails matching persisted verified Google identities")
  await author.goto("/")
  await closeOnboarding(author)
  const boardId = await createBoard(author)
  await invite(author, boardId, firstEmail)
  await invite(author, boardId, secondEmail)
  const createCard = await author.request.post(`/api/boards/${boardId}/cards`, payload({ title: "Shared browser card", x: 40, y: 40, width: 400, height: 260 }))
  assert.equal(createCard.status(), 201)
  const secondCard = await author.request.post(`/api/boards/${boardId}/cards`, payload({ title: "Second shared card", x: 480, y: 440, width: 320, height: 300 }))
  assert.equal(secondCard.status(), 201)
  const cardsUrl = `/api/boards/${boardId}/cards`
  const currentCards = async (page: Page) => (await (await page.request.get(cardsUrl)).json()).cards as Array<{ id: string; x: number; y: number; width: number; height: number }>
  const sourceGeometry = await currentCards(author)
  const path = `/boards/${boardId}`
  await Promise.all([author.goto(path), first.goto(path), second.goto(path)])
  await Promise.all([closeOnboarding(author), closeOnboarding(first), closeOnboarding(second)])
  await first.getByRole("heading", { name: "Shared browser card" }).waitFor()
  await second.getByRole("heading", { name: "Shared browser card" }).waitFor()
  await first.getByText("Customize my layout", { exact: true }).waitFor()
  await second.getByText("Customize my layout", { exact: true }).waitFor()
  await author.locator('summary[aria-label="Board options"]').click()
  await author.getByRole("button", { name: "Sharing" }).waitFor()
  assert.equal(await first.locator('summary[aria-label="Board options"]').count(), 0)
  assert.equal(await first.getByRole("button", { name: "Sharing" }).count(), 0, "Viewer cannot see sharing management")
  assert.equal(await first.getByText("Connect your bot", { exact: true }).count(), 0, "Viewer cannot see author bot controls")
  await author.getByRole("button", { name: "Sharing", exact: true }).click()
  const sharing = author.getByRole("dialog")
  await sharing.getByText(firstEmail, { exact: true }).waitFor()
  await sharing.getByLabel("Email address").fill("pending-browser@example.test")
  await sharing.getByRole("button", { name: "Add access" }).click()
  await sharing.getByText("pending-browser@example.test", { exact: true }).waitFor()
  await author.screenshot({ path: resolve(screenshotDir, "sharing-dialog.png"), fullPage: true })
  await sharing.getByRole("button", { name: "Close", exact: true }).click()
  await first.getByRole("button", { name: "Customize my layout" }).click()
  const handle = first.getByRole("button", { name: /Move or resize Shared browser card/ })
  await handle.press("ArrowRight")
  await first.getByText("Saved", { exact: true }).waitFor()
  await handle.press("Shift+ArrowDown")
  await first.getByText("Saved", { exact: true }).waitFor()
  await first.reload()
  await first.getByRole("heading", { name: "Shared browser card", exact: true }).waitFor()
  const personal = await currentCards(first)
  assert.equal(personal[0].x, 60)
  assert.equal(personal[0].height, 280)
  assert.deepEqual(await currentCards(author), sourceGeometry)
  const extraContext = await context(firstToken, 1280, 800)
  const extra = await extraContext.newPage()
  await extra.goto(path)
  await extra.getByRole("heading", { name: "Shared browser card", exact: true }).waitFor()
  assert.deepEqual(await currentCards(extra), personal)
  await first.screenshot({ path: resolve(screenshotDir, "viewer-desktop.png"), fullPage: true })
  await second.screenshot({ path: resolve(screenshotDir, "viewer-mobile.png"), fullPage: true })
  await author.screenshot({ path: resolve(screenshotDir, "author-desktop.png"), fullPage: true })
  await second.getByRole("button", { name: "Customize my layout" }).click()
  await second.getByRole("button", { name: "Auto-layout" }).waitFor()
  await second.getByRole("button", { name: "Reset to author’s layout" }).waitFor()
  await second.getByRole("button", { name: "Auto-layout", exact: true }).click()
  await second.getByText("Saved", { exact: true }).waitFor({ state: "attached" })
  const mobileGeometry = await currentCards(second)
  assert.deepEqual(mobileGeometry.map(card => [card.x, card.y]), [[20, 20], [20, 300]])
  assert.deepEqual(mobileGeometry.map(card => [card.width, card.height]), sourceGeometry.map(card => [card.width, card.height]))
  assert.deepEqual(await currentCards(first), personal)
  await second.screenshot({ path: resolve(screenshotDir, "viewer-mobile-customizing.png"), fullPage: true })
  await second.getByRole("button", { name: "Reset to author’s layout", exact: true }).click()
  await second.getByText("Saved", { exact: true }).waitFor({ state: "attached" })
  assert.deepEqual(await currentCards(second), sourceGeometry)
  await second.getByRole("button", { name: "Auto-layout", exact: true }).click()
  await second.getByText("Saved", { exact: true }).waitFor({ state: "attached" })
  await second.getByRole("button", { name: "Play slideshow" }).click()
  await second.locator(".presentation-stage").waitFor({ state: "visible" })
  await second.screenshot({ path: resolve(screenshotDir, "viewer-mobile-slideshow.png"), fullPage: true })

  const list = await author.request.get(`/api/boards/${boardId}/shares`)
  assert.equal(list.status(), 200)
  const shares = (await list.json() as { shares: Array<{ id: string; email: string }> }).shares
  const secondShare = shares.find((share) => share.email === secondEmail.toLowerCase())
  assert(secondShare)
  const revoked = await author.request.delete(`/api/boards/${boardId}/shares/${secondShare.id}`, payload({}))
  assert.equal(revoked.status(), 200)
  await second.waitForURL((url) => url.pathname !== path)
  assert.equal(await second.getByRole("heading", { name: "Shared browser card" }).count(), 0)
  await second.getByRole("alert").filter({ hasText: "Access to this shared board was removed." }).waitFor()
  await first.getByRole("button", { name: "Customize my layout", exact: true }).click()
  const beforeQueued = await currentCards(first)
  let release!: () => void
  let arrived!: () => void
  const received = new Promise<void>(resolve => { arrived = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  await first.route(`**/api/boards/${boardId}/cards/*`, async route => {
    if (route.request().method() === "PATCH") { arrived(); await blocked }
    await route.continue()
  })
  await first.getByRole("button", { name: /Move or resize Shared browser card/ }).press("ArrowRight")
  await received
  await first.getByRole("button", { name: /Move or resize Shared browser card/ }).press("ArrowRight")
  const firstShare = shares.find(share => share.email === firstEmail.toLowerCase())
  assert(firstShare)
  assert.equal((await author.request.delete(`/api/boards/${boardId}/shares/${firstShare.id}`, payload({}))).status(), 200)
  release()
  await first.waitForURL(url => url.pathname !== path)
  await first.getByRole("alert").filter({ hasText: "Access to this shared board was removed." }).waitFor()
  await first.unroute(`**/api/boards/${boardId}/cards/*`)
  await invite(author, boardId, firstEmail)
  await first.goto(path)
  await first.getByRole("heading", { name: "Shared browser card", exact: true }).waitFor()
  assert.deepEqual(await currentCards(first), beforeQueued, "Queued saves cannot bypass access removal")
  const ownWorkspace = await (await first.request.get("/api/boards")).json() as { originalBoardId: string }
  await first.locator(`[role="tab"][href="/boards/${ownWorkspace.originalBoardId}"]`).click()
  await first.getByRole("button", { name: "Edit layout", exact: true }).waitFor()
  await closeOnboarding(first)
  await first.locator(`[role="tab"][href="${path}"]`).click()
  await first.getByRole("heading", { name: "Shared browser card", exact: true }).waitFor()
  await first.getByRole("button", { name: "Customize my layout", exact: true }).click()
  let retiredRelease!: () => void
  let retiredArrived!: () => void
  const retiredReceived = new Promise<void>(resolve => { retiredArrived = resolve })
  const retiredBlocked = new Promise<void>(resolve => { retiredRelease = resolve })
  await first.route(`**/api/boards/${boardId}/cards/*`, async route => {
    if (route.request().method() === "PATCH") {
      retiredArrived()
      await retiredBlocked
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Board not found" }) })
    } else await route.continue()
  })
  await first.getByRole("button", { name: /Move or resize Shared browser card/ }).press("ArrowRight")
  await retiredReceived
  await first.goBack()
  await first.getByRole("button", { name: "Edit layout", exact: true }).waitFor()
  retiredRelease()
  await first.waitForTimeout(150)
  assert.equal(new URL(first.url()).pathname, `/boards/${ownWorkspace.originalBoardId}`, "A retired rejection cannot redirect the next board")
  assert.equal(await first.getByRole("alert").filter({ hasText: "Access to this shared board was removed." }).count(), 0)
  await first.unroute(`**/api/boards/${boardId}/cards/*`)

  await invite(author, boardId, secondEmail)
  const secondWorkspace = await (await second.request.get("/api/boards")).json() as { boards: Array<{ id: string; role: string }> }
  const earlierBoard = secondWorkspace.boards.find(board => board.role === "viewer" && board.id !== boardId)
  assert(earlierBoard, "Smoke fixtures provide an earlier shared board")
  let lateRelease!: () => void
  let lateArrived!: () => void
  const lateReceived = new Promise<void>(resolve => { lateArrived = resolve })
  const lateBlocked = new Promise<void>(resolve => { lateRelease = resolve })
  await second.goto(`/boards/${earlierBoard.id}`)
  await second.getByRole("button", { name: "Play slideshow" }).waitFor()
  await second.route(`**/api/boards/${earlierBoard.id}/cards`, async route => {
    lateArrived()
    await lateBlocked
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Board not found" }) })
  })
  await second.bringToFront()
  await second.getByRole("button", { name: "Play slideshow" }).click()
  await second.locator(".presentation-stage").waitFor()
  await lateReceived
  await second.locator(`.presentation-panel[data-board-id="${boardId}"]:not(.presentation-preloaded):not(.presentation-incoming)`).waitFor({ timeout: 25_000 }).catch(async error => {
    await second.screenshot({ path: resolve(screenshotDir, "late-poll-failure.png"), fullPage: true })
    console.error(await second.evaluate(() => ({ headings: [...document.querySelectorAll("h1,h2")].map(x => x.textContent), path: location.pathname, hidden: document.hidden, stage: document.querySelector(".presentation-stage")?.outerHTML.slice(0, 140), panels: [...document.querySelectorAll(".presentation-panel")].map(panel => [panel.getAttribute("data-board-id"), panel.className]) })))
    throw error
  })
  lateRelease()
  await second.waitForTimeout(150)
  assert.equal(await second.locator(".presentation-stage").count(), 1, "A late removed-board poll cannot stop the authorized next slide")
  assert.equal(new URL(second.url()).pathname, path)
  await second.unroute(`**/api/boards/${earlierBoard.id}/cards`)
  await second.mouse.move(30, 30)
  await second.getByRole("button", { name: "Stop slideshow" }).click()
  console.log(`Shared board browser check passed. Screenshots: ${screenshotDir}`)
} finally {
  await Promise.all(contexts.map((current) => current.close()))
  await browser.close()
}
