import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, type BrowserContext, type Page } from "playwright"
import Database from "better-sqlite3"

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
  await author.getByRole("button", { name: "Account menu for Author" }).click()
  await author.getByRole("menuitem", { name: "Shares", exact: true }).click()
  await sharing.getByText(firstEmail, { exact: true }).waitFor()
  await sharing.getByRole("button", { name: "Close", exact: true }).click()
  await first.getByRole("button", { name: "Account menu for First" }).click()
  assert.equal(await first.getByRole("menuitem", { name: "Shares", exact: true }).count(), 0, "Only the author sees Shares in the account menu")
  await first.keyboard.press("Escape")
  for (const method of ["GET", "POST", "DELETE"] as const) {
    let releaseRequest!: () => void
    let requestArrived!: () => void
    const receivedRequest = new Promise<void>(resolve => { requestArrived = resolve })
    const blockedRequest = new Promise<void>(resolve => { releaseRequest = resolve })
    const sharesRoute = `**/api/boards/${boardId}/shares${method === "DELETE" ? "/*" : ""}`
    await author.route(sharesRoute, async route => {
      if (route.request().method() !== method) { await route.continue(); return }
      requestArrived()
      await blockedRequest
      await route.continue().catch(() => {})
    })
    try {
      await author.locator('summary[aria-label="Board options"]').click()
      await author.getByRole("button", { name: "Sharing", exact: true }).click()
      if (method !== "GET") {
        await sharing.getByText(firstEmail, { exact: true }).waitFor()
        if (method === "POST") {
          await sharing.getByLabel("Email address").fill("stalled-browser@example.test")
          await sharing.getByRole("button", { name: "Add access" }).click()
        } else await sharing.getByRole("button", { name: `Remove access for ${firstEmail}` }).click()
      }
      await receivedRequest
      const cancelled = author.waitForEvent("requestfailed", {
        predicate: request => request.method() === method && request.url().includes(`/api/boards/${boardId}/shares`), timeout: 2500,
      })
      void cancelled.catch(() => {})
      if (method === "POST") await author.keyboard.press("Escape")
      else await sharing.getByRole("button", { name: "Close", exact: true }).click()
      await sharing.waitFor({ state: "hidden", timeout: 1500 })
      await cancelled
      assert.equal(new URL(author.url()).pathname, path, "Closing stalled sharing restores the same board")
    } finally {
      releaseRequest()
      await author.unroute(sharesRoute)
    }
  }
  const fixturePath = process.env.E2E_FIXTURE_DATABASE_PATH
  assert(fixturePath, "The sharing harness must supply its temporary database for the changed-email fixture")
  const fixture = new Database(fixturePath)
  try {
    assert.equal(fixture.prepare('UPDATE "BoardGrant" SET "email" = ? WHERE "boardId" = ? AND "email" = ?').run("former-browser@example.test", boardId, firstEmail).changes, 1)
  } finally { fixture.close() }
  const oldShares = (await (await author.request.get(`/api/boards/${boardId}/shares`)).json()).shares as Array<{ id: string; email: string }>
  const changedGrantId = oldShares.find(share => share.email === "former-browser@example.test")!.id
  await author.locator('summary[aria-label="Board options"]').click()
  await author.getByRole("button", { name: "Sharing", exact: true }).click()
  await sharing.getByText("former-browser@example.test", { exact: true }).waitFor()
  await sharing.getByLabel("Email address").fill(firstEmail)
  const changedShare = author.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/api/boards/${boardId}/shares`))
  await sharing.getByRole("button", { name: "Add access" }).click()
  assert.equal((await (await changedShare).json()).share.id, changedGrantId, "A changed verified email keeps the active grant ID")
  await sharing.getByText(firstEmail, { exact: true }).waitFor({ timeout: 1500 })
  assert.equal(await sharing.getByText("former-browser@example.test", { exact: true }).count(), 0, "The existing row adopts the server's updated email")
  await sharing.getByRole("button", { name: "Close", exact: true }).click()
  const duplicateFixture = new Database(fixturePath)
  try {
    duplicateFixture.prepare('UPDATE "BoardGrant" SET "email" = ? WHERE "id" = ?').run("former-browser@example.test", changedGrantId)
    duplicateFixture.prepare('INSERT INTO "BoardGrant" ("id", "boardId", "email") VALUES (?, ?, ?)').run(`${changedGrantId}-pending`, boardId, firstEmail)
  } finally { duplicateFixture.close() }
  await author.locator('summary[aria-label="Board options"]').click()
  await author.getByRole("button", { name: "Sharing", exact: true }).click()
  await sharing.getByText("former-browser@example.test", { exact: true }).waitFor()
  await sharing.getByText(firstEmail, { exact: true }).waitFor()
  await sharing.getByLabel("Email address").fill(firstEmail)
  const mergedShare = author.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/api/boards/${boardId}/shares`))
  await sharing.getByRole("button", { name: "Add access" }).click()
  assert.equal((await (await mergedShare).json()).share.id, changedGrantId)
  await sharing.getByText("former-browser@example.test", { exact: true }).waitFor({ state: "hidden", timeout: 1500 })
  assert.equal(await sharing.getByText(firstEmail, { exact: true }).count(), 1, "Reconciliation removes the superseded pending row from the open dialog")
  await sharing.getByRole("button", { name: "Close", exact: true }).click()
  const revokeFixture = new Database(fixturePath)
  try {
    revokeFixture.prepare('UPDATE "BoardGrant" SET "email" = ? WHERE "id" = ?').run("former-browser@example.test", changedGrantId)
    revokeFixture.prepare('INSERT INTO "BoardGrant" ("id", "boardId", "email") VALUES (?, ?, ?)').run(`${changedGrantId}-pending`, boardId, firstEmail)
  } finally { revokeFixture.close() }
  await author.locator('summary[aria-label="Board options"]').click()
  await author.getByRole("button", { name: "Sharing", exact: true }).click()
  await sharing.getByText("former-browser@example.test", { exact: true }).waitFor()
  await sharing.getByText(firstEmail, { exact: true }).waitFor()
  await sharing.getByRole("button", { name: "Remove access for former-browser@example.test" }).click()
  await sharing.getByText("former-browser@example.test", { exact: true }).waitFor({ state: "hidden", timeout: 1500 })
  assert.equal(await sharing.getByText(firstEmail, { exact: true }).count(), 0, "Revocation removes both the active and superseded pending rows")
  await sharing.getByLabel("Email address").fill(firstEmail)
  await sharing.getByRole("button", { name: "Add access" }).click()
  await sharing.getByText(firstEmail, { exact: true }).waitFor()
  await sharing.getByRole("button", { name: "Close", exact: true }).click()
  await first.goto(path)
  await first.getByRole("heading", { name: "Shared browser card" }).waitFor()
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

  for (const order of ["route-first", "poll-first"] as const) {
    const created = await author.request.post("/api/boards", payload({ name: `Revoked navigation ${order}` }))
    assert.equal(created.status(), 201)
    const destinationId = ((await created.json()) as { board: { id: string } }).board.id
    assert.equal((await author.request.post(`/api/boards/${destinationId}/cards`, payload({ title: "Revoked navigation content", x: 20, y: 20, width: 400, height: 260 }))).status(), 201)
    const grantId = await invite(author, destinationId, firstEmail)
    const destinationPath = `/boards/${destinationId}`
    await first.goto(`/boards/${ownWorkspace.originalBoardId}`)
    await first.getByRole("dialog", { name: "Connect your bot" }).waitFor()
    await closeOnboarding(first)
    let releaseRoute!: () => void
    let routeArrived!: () => void
    const routeReceived = new Promise<void>(resolve => { routeArrived = resolve })
    const routeBlocked = new Promise<void>(resolve => { releaseRoute = resolve })
    let releaseWorkspace!: () => void
    const workspaceBlocked = new Promise<void>(resolve => { releaseWorkspace = resolve })
    await first.route("**/api/boards", async route => {
      await workspaceBlocked
      await route.continue().catch(() => {})
    })
    await first.route(`**${destinationPath}?*`, async route => {
      routeArrived()
      await routeBlocked
      await route.continue().catch(() => {})
    })
    try {
      await first.locator(`[role="tab"][href="${destinationPath}"]`).click()
      await routeReceived
      assert.equal((await author.request.delete(`/api/boards/${destinationId}/shares/${grantId}`, payload({}))).status(), 200)
      if (order === "poll-first") {
        releaseWorkspace()
        await first.locator(`[role="tab"][href="${destinationPath}"]`).waitFor({ state: "hidden" })
      }
      releaseRoute()
      await first.waitForURL(url => url.pathname === destinationPath)
      await first.getByRole("heading", { name: "404", exact: true }).waitFor()
      releaseWorkspace()
      assert.equal(await first.locator(".board-workspace").count(), 0, `${order}: revoked destination unmounts the workspace`)
      assert.equal(await first.getByRole("status").filter({ hasText: "Loading board" }).count(), 0, `${order}: revoked destination cannot leave a loading workspace`)
      assert.equal(await first.getByRole("heading", { name: "Revoked navigation content", exact: true }).count(), 0)
      console.log(`${order}: revoked tab navigation renders 404 without a workspace or shared content`)
    } finally {
      releaseRoute()
      releaseWorkspace()
      await first.unroute(`**${destinationPath}?*`)
      await first.unroute("**/api/boards")
    }
  }
  await first.goto(`/boards/${ownWorkspace.originalBoardId}`)
  await first.getByRole("dialog", { name: "Connect your bot" }).waitFor()
  await closeOnboarding(first)
  await first.getByRole("button", { name: "Edit layout", exact: true }).waitFor()

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
