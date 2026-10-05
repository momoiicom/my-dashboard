import assert from "node:assert/strict"
import { chromium, type Page } from "playwright"

const base = process.env.E2E_BASE_URL
const sessionToken = process.env.E2E_SESSION_TOKEN
assert(
  base && sessionToken,
  "Board browser suite requires an isolated E2E server and signed session"
)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  baseURL: base,
  viewport: { width: 1440, height: 900 },
})
await context.addCookies([
  {
    url: base,
    name: "next-auth.session-token",
    value: sessionToken,
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
  },
])
const page = await context.newPage()
const api = context.request
const boardPath = (id: string) => `/boards/${id}`
const cardPath = (id: string) => `/api/boards/${id}/cards`
const body = (value: unknown) => ({ data: value, headers: { origin: base } })

async function workspace() {
  const response = await api.get("/api/boards")
  assert.equal(response.status(), 200)
  return response.json() as Promise<{
    originalBoardId: string
    boards: Array<{ id: string; name: string }>
  }>
}
async function addBoard(name: string) {
  const response = await api.post("/api/boards", body({ name }))
  assert.equal(response.status(), 201)
  return ((await response.json()) as { board: { id: string } }).board.id
}
async function addCard(boardId: string, title: string, x: number, y: number) {
  const response = await api.post(
    cardPath(boardId),
    body({ title, x, y, width: 400, height: 260 })
  )
  assert.equal(response.status(), 201)
  return ((await response.json()) as { card: { id: string } }).card.id
}
async function closeOnboarding(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Connect your bot" })
  if (await dialog.isVisible())
    await dialog.getByRole("button", { name: "Close" }).first().click()
}
async function phase(page: Page, expected: string) {
  await page.locator(".presentation-stage").waitFor({ state: "visible" })
  assert.equal(
    await page.locator(".presentation-stage").getAttribute("data-phase"),
    expected
  )
}
async function currentPanel(page: Page) {
  return page
    .locator(
      ".presentation-panel:not(.presentation-preloaded):not(.presentation-incoming)"
    )
    .getAttribute("data-board-id")
}

try {
  await page.goto("/")
  const initial = await workspace()
  const original = initial.originalBoardId
  await page.waitForURL(`**${boardPath(original)}`)
  await closeOnboarding(page)
  const secondReviewFailures: string[] = []
  const accessible = await addBoard("Accessible slide")
  const hiddenNext = await addBoard("Hidden next slide")
  await addCard(hiddenNext, "Hidden next card", 20, 20)
  const axConnection = await api.post("/api/bot/connection", body({}))
  assert.equal(axConnection.status(), 200)
  const axToken = ((await axConnection.json()) as { token: string }).token
  const axDocument = await api.put(
    `/api/bot/cards/acceptance-ax?boardId=${accessible}`,
    {
      data: {
        schemaVersion: "1",
        title: "Accessible card",
        components: [
          {
            component: "metric",
            value: { label: "Visible metric", value: "AX value 42" },
          },
          { component: "paragraph", value: "Visible presentation paragraph" },
          {
            component: "table",
            value: {
              columns: [{ key: "data", label: "Visible column" }],
              rows: [{ data: "Visible table value" }],
            },
          },
          {
            component: "richtext",
            value:
              '<a href="https://example.test/rich" target="_blank">Rich text link</a>',
          },
          {
            component: "column",
            value: [
              {
                component: "link",
                value: {
                  href: "https://example.test/link",
                  label: "Presentation link",
                },
              },
              {
                component: "map",
                value: {
                  latitude: 51.5074,
                  longitude: -0.1278,
                  label: "Read-only London",
                },
              },
              {
                component: "chart",
                value: {
                  type: "bar",
                  title: "Accessible chart",
                  xKey: "day",
                  series: [{ key: "value", label: "Chart value" }],
                  data: [{ day: "Monday", value: 7 }],
                },
                options: { height: 180 },
              },
            ],
          },
        ],
      },
      headers: { authorization: `Bearer ${axToken}` },
    }
  )
  assert.equal(axDocument.status(), 201)
  await page.route("**www.openstreetmap.org/export/embed.html**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<button id="map-control">Map control</button>',
    })
  )
  try {
    await page.goto(boardPath(accessible))
    await page.getByRole("heading", { name: "Accessible card" }).waitFor()
    await page.getByRole("button", { name: "Play slideshow" }).click()
    await phase(page, "dwelling")
    await page.locator(".presentation-preloaded").waitFor({ state: "attached" })
    const axSession = await context.newCDPSession(page)
    const tree = await axSession.send("Accessibility.getFullAXTree")
    await axSession.detach()
    const exposedNames = tree.nodes
      .filter((node) => !node.ignored)
      .map((node) => node.name?.value)
    for (const text of [
      "Accessible card",
      "AX value 42",
      "Visible presentation paragraph",
      "Visible table value",
    ])
      assert(
        exposedNames.includes(text),
        `${text} must be exposed in the accessibility tree`
      )
    assert(
      !exposedNames.includes("Hidden next card"),
      "Preloaded card content must stay outside accessibility tree"
    )
    const panel = page.locator(
      ".presentation-panel:not(.presentation-preloaded):not(.presentation-incoming)"
    )
    for (const key of ["Tab", "Shift+Tab", "Tab"]) {
      await page.keyboard.press(key)
      assert.equal(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest(".presentation-panel"))
        ),
        false,
        `${key} must not enter a read-only card`
      )
    }
    for (const selector of [
      "a.bot-link",
      ".bot-richtext a",
      "summary",
      "svg[tabindex]",
    ]) {
      await panel
        .locator(selector)
        .first()
        .evaluate((element) => (element as HTMLElement).focus())
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label")
        ),
        "Stop slideshow",
        `${selector} focus must redirect to Stop`
      )
    }
    assert.equal(
      await panel.locator(".recharts-tooltip-wrapper").isVisible(),
      false,
      "Redirected chart focus must not activate its tooltip"
    )
    const pageCount = context.pages().length
    for (const selector of ["a.bot-link", ".bot-richtext a", "summary"]) {
      await panel
        .locator(selector)
        .evaluate((element) => (element as HTMLElement).click())
    }
    await page.waitForTimeout(100)
    assert.equal(
      context.pages().length,
      pageCount,
      "Read-only links must not open tabs"
    )
    assert.equal(
      await panel
        .locator(".bot-chart details")
        .evaluate((element) => (element as HTMLDetailsElement).open),
      false,
      "Presentation chart summary must remain inactive"
    )
    await panel
      .locator("iframe")
      .evaluate((element) => (element as HTMLIFrameElement).focus())
    assert.equal(
      await page.evaluate(() => document.activeElement?.tagName === "IFRAME"),
      false,
      "Map frame must not receive keyboard focus"
    )
    await page.screenshot({ path: ".e2e/boards/accessible-presentation.png" })
    await page.getByRole("button", { name: "Stop slideshow" }).click()
    await page.getByRole("heading", { name: "Accessible card" }).waitFor()
    await page
      .locator(".bot-link")
      .evaluate((element) => (element as HTMLElement).focus())
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.textContent?.includes("Presentation link")
      ),
      true,
      "Normal card link focus must return after Stop"
    )
    await page
      .locator(".bot-chart summary")
      .evaluate((element) => (element as HTMLElement).click())
    assert.equal(
      await page
        .locator(".bot-chart details")
        .evaluate((element) => (element as HTMLDetailsElement).open),
      true,
      "Normal chart interaction must return after Stop"
    )
    assert.equal(
      await page
        .locator("iframe")
        .evaluate((element) => (element as HTMLIFrameElement).inert),
      false,
      "Normal map must not remain inert after Stop"
    )
    console.log(
      "Review regression passed: visible content is accessible and card interaction stays blocked"
    )
  } catch (cause) {
    secondReviewFailures.push(`Slideshow accessibility: ${String(cause)}`)
  }
  await page.goto(boardPath(original))
  await closeOnboarding(page)
  await page.unroute("**www.openstreetmap.org/export/embed.html**")
  for (const id of [accessible, hiddenNext])
    assert.equal(
      (await api.delete(`/api/boards/${id}`, body({}))).status(),
      200
    )

  const previousBoard = await addBoard("History predecessor")
  const deletedHistory = await addBoard("Deleted history board")
  try {
    await page.goto(boardPath(previousBoard))
    await page
      .getByRole("tab", { name: "Deleted history board", exact: true })
      .click()
    await page.waitForURL(`**${boardPath(deletedHistory)}`)
    const beforeDeleteHistory = await page.evaluate(() => history.length)
    await page.getByRole("button", { name: "Delete board" }).click()
    await page
      .getByRole("dialog", { name: "Delete board?" })
      .getByRole("button", { name: "Delete board" })
      .click()
    await page.waitForURL(`**${boardPath(original)}`)
    assert.equal(
      await page.evaluate(() => history.length),
      beforeDeleteHistory,
      "Deletion must replace the invalid history entry"
    )
    await page.goBack()
    assert.equal(
      page.url(),
      `${base}${boardPath(previousBoard)}`,
      "Back after deletion must return to the prior usable board"
    )
    console.log(
      "Review regression passed: deleted board route is replaced in history"
    )
  } catch (cause) {
    secondReviewFailures.push(`Deleted history: ${String(cause)}`)
  }
  await page.goto(boardPath(original))
  await closeOnboarding(page)
  assert.equal(
    (await api.delete(`/api/boards/${previousBoard}`, body({}))).status(),
    200
  )
  await api.delete(`/api/boards/${deletedHistory}`, body({}))

  const remoteRename = await addBoard("Old remote name")
  try {
    await page.goto(boardPath(remoteRename))
    await page
      .getByRole("tab", { name: "Old remote name", exact: true })
      .waitFor()
    assert.equal(
      (
        await api.patch(
          `/api/boards/${remoteRename}`,
          body({ name: "New remote name" })
        )
      ).status(),
      200
    )
    await page
      .getByRole("tab", { name: "New remote name", exact: true })
      .waitFor()
    await page.getByRole("button", { name: "Rename board" }).click()
    assert.equal(
      await page.getByRole("textbox", { name: "Board name" }).inputValue(),
      "New remote name",
      "Rename dialog must use accepted remote metadata"
    )
    await page.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: "Play slideshow" }).click()
    await phase(page, "dwelling")
    assert.equal(
      await page
        .locator(
          ".presentation-panel:not(.presentation-preloaded):not(.presentation-incoming)"
        )
        .getAttribute("aria-label"),
      "New remote name",
      "Playback must start with accepted remote metadata"
    )
    await page.getByRole("button", { name: "Stop slideshow" }).click()
    console.log(
      "Review regression passed: remote rename reaches dialog and playback"
    )
  } catch (cause) {
    secondReviewFailures.push(`Remote rename: ${String(cause)}`)
  }
  await page.goto(boardPath(original))
  await closeOnboarding(page)
  assert.equal(
    (await api.delete(`/api/boards/${remoteRename}`, body({}))).status(),
    200
  )
  secondReviewFailures.forEach((failure) => console.error(failure))
  assert.deepEqual(
    secondReviewFailures,
    [],
    "Second cloud review browser regressions"
  )

  const reviewFailures: string[] = []
  const deleted = await addBoard("Deleted in another tab")
  await addCard(deleted, "Deleted board content", 20, 20)
  try {
    await page.goto(boardPath(deleted))
    await page.getByRole("heading", { name: "Deleted board content" }).waitFor()
    assert.equal(
      (await api.delete(`/api/boards/${deleted}`, body({}))).status(),
      200
    )
    await page.waitForURL(`**${boardPath(original)}`, { timeout: 6500 })
    assert.equal(
      await page
        .getByRole("heading", { name: "Deleted board content" })
        .count(),
      0
    )
    console.log(
      "Review regression passed: external deletion returns to original board"
    )
  } catch (cause) {
    reviewFailures.push(`External deletion: ${String(cause)}`)
  }

  const capacitySource = await addBoard("Capacity source")
  const capacityTarget = await addBoard("Full destination")
  const capacityCard = await addCard(
    capacitySource,
    "Capacity transfer",
    20,
    20
  )
  await addCard(capacityTarget, "Bottom card", 20, 10000)
  try {
    await page.goto(boardPath(capacitySource))
    await page.getByRole("button", { name: "Edit layout" }).click()
    const response = page.waitForResponse((value) =>
      value.url().endsWith(`/api/cards/${capacityCard}/move`)
    )
    await page
      .getByRole("combobox", { name: "Board for Capacity transfer" })
      .selectOption(capacityTarget)
    assert.equal((await response).status(), 409)
    const error = page.locator(".dashboard-error")
    await error.waitFor()
    assert.match(
      await error.innerText(),
      /No space below existing cards.*Move or remove cards/
    )
    assert.equal(
      await page
        .getByRole("heading", { name: "Capacity transfer" })
        .isVisible(),
      true
    )
    const retained = (
      (await (await api.get(cardPath(capacitySource))).json()) as {
        cards: Array<{ id: string }>
      }
    ).cards
    assert(
      retained.some((card) => card.id === capacityCard),
      "Capacity error must leave source membership intact"
    )
    console.log(
      "Review regression passed: capacity diagnosis survives transfer error"
    )
  } catch (cause) {
    reviewFailures.push(`Capacity diagnosis: ${String(cause)}`)
  }

  const queueSource = await addBoard("Queued edit source")
  const queueTarget = await addBoard("Queued edit target")
  const queueCard = await addCard(queueSource, "Queued movement", 120, 80)
  let releaseQueue!: () => void
  let queueStarted!: () => void
  const queueHold = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })
  const queueSeen = new Promise<void>((resolve) => {
    queueStarted = resolve
  })
  let patchCount = 0
  await page.route(
    `**/api/boards/${queueSource}/cards/${queueCard}`,
    async (route) => {
      if (route.request().method() === "PATCH") {
        patchCount++
        if (patchCount === 1) {
          queueStarted()
          await queueHold
        }
      }
      await route.continue().catch(() => {})
    }
  )
  try {
    await page.goto(boardPath(queueSource))
    await page.getByRole("button", { name: "Edit layout" }).click()
    const handle = page.getByRole("button", {
      name: /Move or resize Queued movement/,
    })
    await handle.press("ArrowRight")
    await queueSeen
    await handle.press("ArrowRight")
    await handle.press("ArrowRight")
    const tab = await page
      .getByRole("tab", { name: "Queued edit target", exact: true })
      .boundingBox()
    assert(tab)
    await page.mouse.click(tab.x + tab.width / 2, tab.y + tab.height / 2)
    await page.waitForTimeout(100)
    assert.equal(
      page.url(),
      `${base}${boardPath(queueSource)}`,
      "Tab navigation must wait for queued edits"
    )
    for (const action of ["Create board", "Rename board", "Delete board"]) {
      const button = await page
        .getByRole("button", { name: action, exact: true })
        .boundingBox()
      assert(button)
      await page.mouse.click(
        button.x + button.width / 2,
        button.y + button.height / 2
      )
      assert.equal(
        await page.getByRole("dialog").count(),
        0,
        `${action} must wait for queued edits`
      )
    }
    releaseQueue()
    await page.waitForFunction(
      () =>
        !(
          document.querySelector(
            '[aria-label="Play slideshow"]'
          ) as HTMLButtonElement
        ).disabled
    )
    assert.equal(patchCount, 3, "All three already-invoked edits must be sent")
    const saved = (
      (await (await api.get(cardPath(queueSource))).json()) as {
        cards: Array<{ id: string; x: number }>
      }
    ).cards.find((card) => card.id === queueCard)
    assert.equal(saved?.x, 180, "All queued keyboard movements must persist")
    await page
      .getByRole("tab", { name: "Queued edit target", exact: true })
      .click()
    await page.waitForURL(`**${boardPath(queueTarget)}`)
    console.log(
      "Review regression passed: navigation and board CRUD wait for all queued edits"
    )
  } catch (cause) {
    reviewFailures.push(`Queued edits: ${String(cause)}`)
  } finally {
    releaseQueue()
    await page.unroute(`**/api/boards/${queueSource}/cards/${queueCard}`)
  }
  await page.goto(boardPath(original))
  await closeOnboarding(page)
  for (const id of [capacitySource, capacityTarget, queueSource, queueTarget])
    assert.equal(
      (await api.delete(`/api/boards/${id}`, body({}))).status(),
      200
    )
  reviewFailures.forEach((failure) => console.error(failure))
  assert.deepEqual(reviewFailures, [], "Cloud review browser regressions")
  await page.reload()
  await closeOnboarding(page)
  assert.equal(
    await page.getByRole("tablist", { name: "Boards" }).isVisible(),
    true
  )
  assert.equal(
    await page.getByRole("button", { name: "Delete board" }).isDisabled(),
    true
  )
  await page.getByRole("button", { name: "Create board" }).click()
  await page
    .getByRole("textbox", { name: "Board name" })
    .fill("  Permanent name  ")
  await page.getByRole("button", { name: "Save board" }).click()
  const temporary = (await workspace()).boards.at(-1)!.id
  await page.waitForURL(`**${boardPath(temporary)}`)
  let releasePoll!: () => void
  let pollSeen!: () => void
  let pollFlushed!: () => void
  const pollHold = new Promise<void>((resolve) => {
    releasePoll = resolve
  })
  const pollCaptured = new Promise<void>((resolve) => {
    pollSeen = resolve
  })
  const pollDelivered = new Promise<void>((resolve) => {
    pollFlushed = resolve
  })
  await page.route("**/api/boards", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    const old = (await response.json()) as { boards: Array<{ name: string }> }
    assert(
      old.boards.some((board) => board.name === "Permanent name"),
      "Held poll must contain the old board name"
    )
    pollSeen()
    await pollHold
    await route.fulfill({ response })
    pollFlushed()
  })
  await pollCaptured
  await page.getByRole("button", { name: "Rename board" }).click()
  await page.getByRole("textbox", { name: "Board name" }).fill("Renamed board")
  await page.getByRole("button", { name: "Save board" }).click()
  await page
    .getByRole("tab", { name: "Renamed board" })
    .waitFor({ state: "visible" })
  releasePoll()
  await pollDelivered
  await page.waitForTimeout(50)
  assert.equal(
    await page.getByRole("tab", { name: "Renamed board" }).isVisible(),
    true,
    "Stale metadata poll must not roll back rename"
  )
  assert.equal(
    await page.getByRole("tab", { name: "Permanent name" }).count(),
    0
  )
  await page.unroute("**/api/boards")
  assert.equal(page.url(), `${base}${boardPath(temporary)}`)
  await page.getByRole("button", { name: "Play slideshow" }).click()
  await page.locator(".presentation-stage").waitFor({ state: "visible" })
  await page.getByRole("button", { name: "Stop slideshow" }).click()
  await page
    .getByRole("tab", { name: "Renamed board" })
    .waitFor({ state: "visible" })
  await page.waitForTimeout(50)
  assert.equal(
    await page.getByRole("tab", { name: "Renamed board" }).isVisible(),
    true
  )
  assert.equal(
    await page.getByRole("tab", { name: "Permanent name" }).count(),
    0,
    "Stop must not restore stale page metadata"
  )
  await page.reload()
  assert.equal(
    await page.getByRole("tab", { name: "Renamed board" }).isVisible(),
    true
  )
  await page.getByRole("tab", { name: "Renamed board" }).press("Home")
  await page.waitForURL(`**${boardPath(original)}`)
  await page.getByRole("tab", { name: "Dashboard" }).press("End")
  await page.waitForURL(`**${boardPath(temporary)}`)
  await page.goBack()
  await page.waitForURL(`**${boardPath(original)}`)
  await page.goForward()
  await page.waitForURL(`**${boardPath(temporary)}`)
  await page.getByRole("button", { name: "Delete board" }).click()
  assert.match(
    await page.getByRole("dialog", { name: "Delete board?" }).innerText(),
    /all cards on this board will be permanently deleted/
  )
  await page.getByRole("button", { name: "Cancel" }).click()
  await page
    .getByRole("tab", { name: "Renamed board" })
    .waitFor({ state: "visible" })
  await page.getByRole("button", { name: "Delete board" }).click()
  await page
    .getByRole("dialog", { name: "Delete board?" })
    .getByRole("button", { name: "Delete board" })
    .click()
  await page.waitForURL(`**${boardPath(original)}`)
  assert.equal(
    (await workspace()).boards.some((board) => board.id === temporary),
    false
  )

  const first = await addBoard("First slide")
  const second = await addBoard("Second slide")
  const cardId = await addCard(first, "Transfer target", 120, 80)
  await addCard(second, "Second card", 980, 820)
  await page.goto(boardPath(first))
  await page.getByRole("heading", { name: "Transfer target" }).waitFor()
  assert.equal(
    await page
      .getByRole("combobox", { name: "Board for Transfer target" })
      .count(),
    0
  )
  await page.getByRole("button", { name: "Edit layout" }).click()
  let releaseTransfer!: () => void
  let transferStarted!: () => void
  const heldTransfer = new Promise<void>((resolve) => { releaseTransfer = resolve })
  const transferSeen = new Promise<void>((resolve) => { transferStarted = resolve })
  await page.route(`**/api/cards/${cardId}/move`, async (route) => {
    transferStarted()
    await heldTransfer
    await route.continue()
  })
  await page
    .getByRole("combobox", { name: "Board for Transfer target" })
    .selectOption(second)
  await transferSeen
  await page.getByRole("button", { name: "Remove Transfer target" }).click()
  const transferResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/api/cards/${cardId}/move`)
  )
  releaseTransfer()
  assert.equal((await transferResponse).status(), 200)
  await page.unroute(`**/api/cards/${cardId}/move`)
  await page
    .getByRole("heading", { name: "Transfer target" })
    .waitFor({ state: "detached" })
  await page.waitForFunction(() =>
    !(document.querySelector('[aria-label="Play slideshow"]') as HTMLButtonElement).disabled
  )
  assert.equal(await page.getByRole("status").filter({ hasText: "Saving" }).count(), 0)
  const transferredCard = (
    (await (await api.get(cardPath(second))).json()) as { cards: Array<{ id: string }> }
  ).cards.find((card) => card.id === cardId)
  assert(transferredCard, "Queued source Remove must not delete transferred card")
  const transferLink = page
    .getByRole("status")
    .getByRole("link", { name: "Second slide" })
  await transferLink.click()
  await page.waitForURL(`**${boardPath(second)}`)
  await page.getByRole("heading", { name: "Transfer target" }).waitFor()
  const moved = (
    (await (await api.get(cardPath(second))).json()) as {
      cards: Array<{ id: string; x: number; width: number; height: number }>
    }
  ).cards.find((card) => card.id === cardId)
  assert.deepEqual([moved?.x, moved?.width, moved?.height], [20, 400, 260])
  if (await page.getByRole("button", { name: "Done editing" }).isVisible())
    await page.getByRole("button", { name: "Done editing" }).click()
  const connectionResponse = await api.post("/api/bot/connection", body({}))
  assert.equal(connectionResponse.status(), 200)
  const token = ((await connectionResponse.json()) as { token: string }).token
  const mapResponse = await api.put(
    `/api/bot/cards/acceptance-map?boardId=${second}`,
    {
      data: {
        schemaVersion: "1",
        title: "Map test",
        components: [
          {
            component: "map",
            value: { latitude: 51.5074, longitude: -0.1278, label: "London" },
          },
        ],
      },
      headers: { authorization: `Bearer ${token}` },
    }
  )
  assert.equal(mapResponse.status(), 201)
  const mapCardId = ((await mapResponse.json()) as { card: { id: string } }).card.id
  await page.reload()
  await page.getByRole("heading", { name: "Map test" }).waitFor()

  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
    tabScroll: (document.querySelector(".board-tabs") as HTMLElement)
      .scrollWidth,
    tabViewport: (document.querySelector(".board-tabs") as HTMLElement)
      .clientWidth,
  }))
  assert(
    mobile.document <= mobile.viewport + 1,
    `Mobile overflow: ${JSON.stringify(mobile)}`
  )
  assert(
    mobile.tabScroll > mobile.tabViewport,
    "Board tabs must scroll horizontally on mobile"
  )
  await page.screenshot({ path: ".e2e/boards/mobile.png", fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole("button", { name: "Edit layout" }).click()
  const handle = page.getByRole("button", {
    name: /Move or resize Transfer target/,
  })
  let releaseSave!: () => void
  let saveSeen!: () => void
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  const saveStarted = new Promise<void>((resolve) => {
    saveSeen = resolve
  })
  await page.route("**/api/boards/*/cards/*", async (route) => {
    if (
      route.request().method() !== "PATCH" ||
      !route.request().url().endsWith(cardId)
    )
      return route.continue()
    saveSeen()
    await heldSave
    await route.continue()
  })
  await handle.press("ArrowRight")
  await saveStarted
  assert.equal(
    await page.getByRole("button", { name: "Play slideshow" }).isDisabled(),
    true,
    "A pending scoped card save blocks Play"
  )
  assert.equal(await page.locator(".presentation-stage").count(), 0)
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(cardId) && response.request().method() === "PATCH"
  )
  releaseSave()
  assert.equal((await saveResponse).status(), 200)
  await page.unroute("**/api/boards/*/cards/*")
  await handle.scrollIntoViewIfNeeded()
  const dragBox = await handle.boundingBox()
  assert(dragBox)
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    dragBox.x + dragBox.width / 2 + 60,
    dragBox.y + dragBox.height / 2 + 30,
    { steps: 5 }
  )
  await page.waitForFunction(
    () =>
      (
        document.querySelector(
          '[aria-label="Play slideshow"]'
        ) as HTMLButtonElement
      ).disabled
  )
  assert.equal(
    await page.locator(".presentation-stage").count(),
    0,
    "An active drag cannot start playback"
  )
  await page.mouse.up()
  await page.waitForFunction(
    () =>
      !(
        document.querySelector(
          '[aria-label="Play slideshow"]'
        ) as HTMLButtonElement
      ).disabled
  )
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 100))
  const historyLength = await page.evaluate(() => history.length)
  await page.evaluate(() => {
    const host = document.querySelector(".board-workspace") as HTMLElement
    ;(
      window as typeof window & { e2eFullscreenRequests?: number }
    ).e2eFullscreenRequests = 0
    Object.defineProperty(host, "requestFullscreen", {
      configurable: true,
      value: () => {
        ;(window as typeof window & { e2eFullscreenRequests?: number })
          .e2eFullscreenRequests!++
        return Promise.reject(new Error("Fullscreen denied by test"))
      },
    })
  })
  await page.getByRole("button", { name: "Play slideshow" }).click()
  assert.equal(
    await page.evaluate(
      () =>
        (window as typeof window & { e2eFullscreenRequests?: number })
          .e2eFullscreenRequests
    ),
    1
  )
  await phase(page, "dwelling")
  assert.equal(await currentPanel(page), second)
  assert.equal(await page.getByRole("tablist", { name: "Boards" }).count(), 0)
  assert.equal(
    await page.getByRole("button", { name: "Edit layout" }).count(),
    0
  )
  assert.equal(
    await page.getByRole("button", { name: "Stop slideshow" }).isVisible(),
    true
  )
  await page.locator(".presentation-preloaded").waitFor({ state: "attached" })
  const fit = await page.evaluate(() => {
    const panel = document.querySelector(
      ".presentation-panel:not(.presentation-preloaded)"
    ) as HTMLElement
    const canvas = panel.querySelector(".presentation-canvas") as HTMLElement
    const card = canvas.querySelector(".dashboard-card") as HTMLElement
    const stage = document.querySelector(".presentation-stage") as HTMLElement
    const shield = document.querySelector(".presentation-shield") as HTMLElement
    return {
      scale: Number(canvas.style.transform.match(/scale\(([^)]+)\)/)?.[1]),
      card: card.getBoundingClientRect().toJSON(),
      stage: stage.getBoundingClientRect().toJSON(),
      shield: shield.getBoundingClientRect().toJSON(),
      width: card.style.width,
      height: card.style.height,
    }
  })
  assert(fit.scale > 0 && fit.scale <= 1)
  assert(fit.card.left >= fit.stage.left && fit.card.right <= fit.stage.right)
  assert(fit.card.top >= fit.stage.top && fit.card.bottom <= fit.stage.bottom)
  assert.equal(fit.width, "400px")
  assert.equal(fit.height, "260px")
  assert(fit.shield.left <= fit.card.left && fit.shield.right >= fit.card.right)
  const mapShield = await page.evaluate(() => {
    const frame = document.querySelector(
      ".presentation-panel:not(.presentation-preloaded) iframe"
    ) as HTMLIFrameElement
    const rect = frame.getBoundingClientRect()
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    )
    return {
      frame: Boolean(frame),
      hitShield: target?.classList.contains("presentation-shield") ?? false,
    }
  })
  assert.deepEqual(
    mapShield,
    { frame: true, hitShield: true },
    "Presentation shield must capture pointer input over embedded maps"
  )
  await page.clock.runFor(2999)
  assert.equal(
    await page.getByRole("button", { name: "Stop slideshow" }).isVisible(),
    true
  )
  await page.clock.runFor(1)
  assert.match(
    (await page
      .getByRole("button", { name: "Stop slideshow" })
      .getAttribute("class")) ?? "",
    /presentation-stop-hidden/
  )
  await page.evaluate(() => {
    document.querySelector(".presentation-shield")!.dispatchEvent(new Event("touchstart", { bubbles: true }))
  })
  assert.doesNotMatch(
    (await page.getByRole("button", { name: "Stop slideshow" }).getAttribute("class")) ?? "",
    /presentation-stop-hidden/,
    "Touch activity on the presentation shield reveals Stop"
  )
  await page.mouse.move(
    fit.stage.left + fit.stage.width / 2,
    fit.stage.top + fit.stage.height / 2
  )
  assert.equal(
    await page.getByRole("button", { name: "Stop slideshow" }).isVisible(),
    true
  )
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.clock.runFor(20000)
  await phase(page, "dwelling")
  assert.equal(
    await currentPanel(page),
    second,
    "Hidden dwell time cannot advance the board"
  )
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.clock.runFor(11999)
  await phase(page, "dwelling")
  assert.equal(await currentPanel(page), second)
  await page.clock.runFor(1)
  await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
  assert.equal(
    await currentPanel(page),
    second,
    "Outgoing board stays current while sliding"
  )
  const slideAxSession = await context.newCDPSession(page)
  const slideTree = await slideAxSession.send("Accessibility.getFullAXTree")
  await slideAxSession.detach()
  const slideRegions = slideTree.nodes
    .filter((node) => !node.ignored && node.role?.value === "region")
    .map((node) => node.name?.value)
  assert(
    slideRegions.includes("Second slide"),
    "Outgoing board stays accessible until transition completes"
  )
  assert(
    !slideRegions.includes("Dashboard"),
    "Incoming board stays outside accessibility until fully displayed"
  )
  await page.clock.runFor(300)
  await page.locator('.presentation-stage[data-phase="dwelling"]').waitFor()
  assert.equal(await currentPanel(page), original)
  assert.equal(new URL(page.url()).pathname, boardPath(original))
  assert.equal(await page.evaluate(() => history.length), historyLength)

  await page.clock.runFor(15000)
  await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
  await page.clock.runFor(100)
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.clock.runFor(1000)
  assert.equal(
    await page.locator(".presentation-stage").getAttribute("data-hidden"),
    "true"
  )
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.clock.runFor(199)
  await phase(page, "sliding")
  await page.clock.runFor(1)
  await page.locator('.presentation-stage[data-phase="dwelling"]').waitFor()
  assert.equal(await currentPanel(page), first)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Play slideshow" }).waitFor()
  assert.equal(
    await page
      .getByRole("button", { name: "Play slideshow" })
      .evaluate((el) => document.activeElement === el),
    true
  )
  assert.equal(new URL(page.url()).pathname, boardPath(first))
  assert.equal(
    await page.getByRole("button", { name: "Edit layout" }).isVisible(),
    true,
    "Starting playback exits editing"
  )
  assert.equal(
    await page
      .getByRole("combobox", { name: "Board for Transfer target" })
      .count(),
    0
  )
  await page.getByRole("button", { name: "Play slideshow" }).click()
  await phase(page, "dwelling")
  await page.clock.runFor(3001)
  assert.match(
    (await page
      .getByRole("button", { name: "Stop slideshow" })
      .getAttribute("class")) ?? "",
    /presentation-stop-hidden/,
    "Second run must hide controls despite prior Stop focus"
  )
  await page.mouse.move(30, 30)
  await page.getByRole("button", { name: "Stop slideshow" }).focus()
  await page.clock.runFor(3001)
  assert.doesNotMatch(
    (await page
      .getByRole("button", { name: "Stop slideshow" })
      .getAttribute("class")) ?? "",
    /presentation-stop-hidden/,
    "Focused Stop remains visible beyond inactivity timeout"
  )
  await page
    .getByRole("button", { name: "Stop slideshow" })
    .evaluate((button) => (button as HTMLElement).blur())
  await page.clock.runFor(3001)
  assert.match(
    (await page
      .getByRole("button", { name: "Stop slideshow" })
      .getAttribute("class")) ?? "",
    /presentation-stop-hidden/
  )
  await page.evaluate(() => {
    const shield = document.querySelector(".presentation-shield")!
    shield.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 }))
  })
  await page.clock.runFor(1)
  assert.doesNotMatch(
    (await page.getByRole("button", { name: "Stop slideshow" }).getAttribute("class")) ?? "",
    /presentation-stop-hidden/,
    "Wheel event on the presentation shield reveals Stop"
  )
  await page.clock.runFor(2000)
  await page.getByRole("button", { name: "Stop slideshow" }).evaluate((button) =>
    button.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 }))
  )
  await page.clock.runFor(1400)
  assert.doesNotMatch(
    (await page.getByRole("button", { name: "Stop slideshow" }).getAttribute("class")) ?? "",
    /presentation-stop-hidden/,
    "Wheel activity over visible Stop extends control visibility"
  )
  await page.mouse.move(30, 30)
  await page.getByRole("button", { name: "Stop slideshow" }).click()
  await page.getByRole("button", { name: "Play slideshow" }).waitFor()
  assert.equal(new URL(page.url()).pathname, boardPath(first))
  await page.goto(boardPath(second))
  await page.locator("iframe").waitFor({ state: "visible" })
  await page.locator("iframe").scrollIntoViewIfNeeded()
  const resumedMap = await page.evaluate(() => {
    const frame = document.querySelector("iframe") as HTMLIFrameElement
    const rect = frame.getBoundingClientRect()
    return (
      document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      ) === frame
    )
  })
  assert.equal(
    resumedMap,
    true,
    "Map receives pointer input after presentation ends"
  )
  await page.goto(boardPath(first))
  await page.getByRole("button", { name: "Play slideshow" }).waitFor()
  await page.screenshot({
    path: ".e2e/boards/desktop-after-presentation.png",
    fullPage: true,
  })

  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.evaluate(() => {
    const host = document.querySelector(".board-workspace") as HTMLElement
    Object.defineProperty(host, "requestFullscreen", {
      configurable: true,
      value: () => Promise.reject(new Error("Fullscreen denied by test")),
    })
  })
  await page.getByRole("button", { name: "Play slideshow" }).click()
  await phase(page, "dwelling")
  await page.locator(".presentation-preloaded").waitFor({ state: "attached" })
  await page.clock.runFor(15000)
  await page
    .locator(
      `.presentation-panel[data-board-id="${second}"]:not(.presentation-preloaded)`
    )
    .waitFor({ state: "visible" })
  await phase(page, "dwelling")
  assert.equal(
    await currentPanel(page),
    second,
    "Reduced motion completes without a slide"
  )
  const cardBeforeUpdate = (
    (await (await api.get(cardPath(second))).json()) as {
      cards: Array<{ id: string; x: number; y: number; width: number; height: number; membershipRevision: number }>
    }
  ).cards.find((card) => card.id === mapCardId)
  assert(cardBeforeUpdate)
  const visibleCanvas = page.locator(
    `.presentation-panel[data-board-id="${second}"]:not(.presentation-preloaded) .presentation-canvas`
  )
  const scaleAtDesktop = await visibleCanvas.evaluate((canvas) =>
    Number((canvas as HTMLElement).style.transform.match(/scale\(([^)]+)\)/)?.[1])
  )
  await page.setViewportSize({ width: 800, height: 600 })
  await page.waitForFunction(
    (previous) => {
      const panel = document.querySelector(
        ".presentation-panel:not(.presentation-preloaded)"
      ) as HTMLElement
      const canvas = panel.querySelector(".presentation-canvas") as HTMLElement
      const scale = Number(canvas.style.transform.match(/scale\(([^)]+)\)/)?.[1])
      return scale > 0 && scale < previous
    },
    scaleAtDesktop
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  const revisedGeometry = {
    x: 3000,
    y: 3000,
    width: cardBeforeUpdate.width,
    height: cardBeforeUpdate.height,
  }
  const geometryResponse = await api.patch(
    `${cardPath(second)}/${mapCardId}`,
    body({ patch: { x: revisedGeometry.x, y: revisedGeometry.y }, membershipRevision: cardBeforeUpdate.membershipRevision })
  )
  assert.equal(geometryResponse.status(), 200)
  const botUpdate = await api.put(
    `/api/bot/cards/acceptance-map?boardId=${second}`,
    {
      data: {
        schemaVersion: "1",
        title: "Map updated",
        components: [
          { component: "map", value: { latitude: 51.5074, longitude: -0.1278, label: "London" } },
        ],
      },
      headers: { authorization: `Bearer ${token}` },
    }
  )
  assert.equal(botUpdate.status(), 200)
  await page.clock.runFor(3000)
  await page
    .locator(
      `.presentation-panel[data-board-id="${second}"]:not(.presentation-preloaded) .dashboard-card-title`
    )
    .filter({ hasText: "Map updated" })
    .waitFor({ state: "visible" })
  const refit = await page.evaluate((id) => {
    const panel = document.querySelector(
      `.presentation-panel[data-board-id="${id}"]:not(.presentation-preloaded)`
    ) as HTMLElement
    const canvas = panel.querySelector(".presentation-canvas") as HTMLElement
    const card = Array.from(canvas.querySelectorAll<HTMLElement>(".dashboard-card"))
      .find((item) => item.querySelector(".dashboard-card-title")?.textContent === "Map updated")!
    const stage = document.querySelector(".presentation-stage") as HTMLElement
    return {
      scale: Number(canvas.style.transform.match(/scale\(([^)]+)\)/)?.[1]),
      card: card.getBoundingClientRect().toJSON(),
      stage: stage.getBoundingClientRect().toJSON(),
      left: card.style.left,
      top: card.style.top,
    }
  }, second)
  assert(refit.scale > 0 && refit.scale < scaleAtDesktop)
  assert.equal(refit.left, "3000px")
  assert.equal(refit.top, "3000px")
  assert(refit.card.left >= refit.stage.left && refit.card.right <= refit.stage.right)
  assert(refit.card.top >= refit.stage.top && refit.card.bottom <= refit.stage.bottom)
  const persisted = (
    (await (await api.get(cardPath(second))).json()) as {
      cards: Array<{ id: string; x: number; y: number; width: number; height: number }>
    }
  ).cards.find((card) => card.id === mapCardId)
  assert.deepEqual(
    persisted && { x: persisted.x, y: persisted.y, width: persisted.width, height: persisted.height },
    revisedGeometry,
    "Presentation fit must leave stored geometry intact"
  )
  await page.mouse.move(30, 30)
  await page.getByRole("button", { name: "Stop slideshow" }).click()
  await page.getByRole("button", { name: "Play slideshow" }).waitFor()
  await page.emulateMedia({ reducedMotion: "no-preference" })

  for (const id of [first, second]) {
    const response = await api.delete(`/api/boards/${id}`, body({}))
    assert.equal(response.status(), 200)
  }
  await page.goto(boardPath(original))
  await closeOnboarding(page)
  assert.deepEqual(
    (await workspace()).boards.map((board) => board.id),
    [original]
  )
  await page.getByRole("button", { name: "Play slideshow" }).click()
  await phase(page, "dwelling")
  assert.equal(await page.locator(".presentation-empty").isVisible(), true)
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowRight")
  await phase(page, "dwelling")
  assert.equal(await currentPanel(page), original, "Arrow keys leave a single-board slideshow running")
  await page.clock.runFor(30000)
  await phase(page, "dwelling")
  assert.equal(
    await currentPanel(page),
    original,
    "A single empty board stays in presentation"
  )
  await page.mouse.move(30, 30)
  await page.getByRole("button", { name: "Stop slideshow" }).click()
  await page.getByRole("button", { name: "Play slideshow" }).waitFor()

  const errorTarget = await addBoard("Load failure target")
  await page.route(`**${cardPath(errorTarget)}`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Simulated outage" }),
    })
  )
  await page.clock.runFor(3000)
  await page.getByRole("tab", { name: "Load failure target" }).waitFor()
  await page.getByRole("button", { name: "Play slideshow" }).click()
  await page.locator(".board-workspace-error").waitFor({ state: "visible" })
  assert.match(
    await page.locator(".board-workspace-error").innerText(),
    /Could not load the next board/
  )
  assert.equal(
    await page.locator(".presentation-stage").count(),
    0,
    "A loading failure tears down presentation"
  )
  await page.unroute(`**${cardPath(errorTarget)}`)
  await page.getByRole("button", { name: "Dismiss error" }).click()
  const surviving = await addBoard("Surviving target")
  await page.clock.runFor(3000)
  await page.getByRole("tab", { name: "Surviving target" }).waitFor()
  await page.getByRole("button", { name: "Play slideshow" }).click()
  await page
    .locator(`.presentation-preloaded[data-board-id="${errorTarget}"]`)
    .waitFor({ state: "attached" })
  const removedTarget = await api.delete(`/api/boards/${errorTarget}`, body({}))
  assert.equal(removedTarget.status(), 200)
  await page.clock.runFor(15000)
  await page
    .locator(
      `.presentation-panel[data-board-id="${surviving}"].presentation-incoming`
    )
    .waitFor({ state: "attached" })
  await page.clock.runFor(300)
  await phase(page, "dwelling")
  assert.equal(
    await currentPanel(page),
    surviving,
    "Deleted target is skipped within captured run order"
  )
  await page.mouse.move(30, 30)
  await page.getByRole("button", { name: "Stop slideshow" }).click()
  const delayedTargetBody = await (await api.get(cardPath(original))).body()
  for (const action of ["ready", "stop", "navigate"] as const) {
    let releaseTarget!: () => void
    let targetRequested!: () => void
    const holdTarget = new Promise<void>((resolve) => {
      releaseTarget = resolve
    })
    const targetSeen = new Promise<void>((resolve) => {
      targetRequested = resolve
    })
    await page.route(`**${cardPath(original)}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue()
      targetRequested()
      await holdTarget
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: delayedTargetBody,
        })
      } catch {}
    })
    await page.getByRole("button", { name: "Play slideshow" }).click()
    await targetSeen
    await phase(page, "dwelling")
    if (action === "ready") {
      await page.clock.runFor(15000)
      await phase(page, "waiting")
      assert.equal(await currentPanel(page), surviving)
      await page.clock.runFor(3000)
      await phase(page, "waiting")
      assert.equal(await currentPanel(page), surviving, "A late target cannot remove the current board")
      releaseTarget()
      await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
      assert.equal(await currentPanel(page), surviving)
      await page.clock.runFor(300)
      await phase(page, "dwelling")
      assert.equal(await currentPanel(page), original)
      await page.clock.runFor(14999)
      await phase(page, "dwelling")
      assert.equal(await currentPanel(page), original, "A delayed target gets a full new dwell")
      await page.mouse.move(30, 30)
      await page.getByRole("button", { name: "Stop slideshow" }).click()
      await page.getByRole("button", { name: "Play slideshow" }).waitFor()
      await page.unroute(`**${cardPath(original)}`)
      await page.goto(boardPath(surviving))
      continue
    }
    if (action === "stop") {
      await page.getByRole("button", { name: "Stop slideshow" }).click()
      await page.getByRole("button", { name: "Play slideshow" }).waitFor()
    } else {
      await page.goto(boardPath(original))
      releaseTarget()
      await closeOnboarding(page)
      await page.getByRole("button", { name: "Play slideshow" }).waitFor()
    }
    if (action === "stop") releaseTarget()
    await page.clock.runFor(16000)
    assert.equal(await page.locator(".presentation-stage").count(), 0)
    assert.equal(
      new URL(page.url()).pathname,
      boardPath(action === "stop" ? surviving : original),
      `A delayed target response must not revive playback after ${action}`
    )
    await page.unroute(`**${cardPath(original)}`)
    if (action === "navigate") await page.goto(boardPath(surviving))
  }
  const keyboardBoard = await addBoard("Keyboard slide")
  await page.clock.runFor(3000)
  await page.getByRole("tab", { name: "Keyboard slide" }).waitFor()
  await page.getByRole("button", { name: "Play slideshow" }).click()
  await phase(page, "dwelling")
  assert.equal(await currentPanel(page), surviving)
  const keyboardHistory = await page.evaluate(() => history.length)
  await page.clock.runFor(1000)
  await page.getByRole("button", { name: "Stop slideshow" }).focus()
  await page.keyboard.down("Space")
  await page.keyboard.down("Space")
  await page.keyboard.up("Space")
  assert.equal(await page.locator(".presentation-stage").getAttribute("data-paused"), "true", "Holding Space pauses once and does not activate the focused Stop button")
  await page.clock.runFor(30000)
  await phase(page, "dwelling")
  assert.equal(await currentPanel(page), surviving, "Space pauses automatic playback indefinitely")
  await page.keyboard.press("Space")
  assert.equal(await page.locator(".presentation-stage").getAttribute("data-paused"), "false")
  await page.clock.runFor(13999)
  assert.equal(await currentPanel(page), surviving, "Space resumes the remaining dwell time")
  await page.clock.runFor(1)
  await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
  await page.clock.runFor(300)
  assert.equal(await currentPanel(page), keyboardBoard)
  const navigateSlide = async (key: "ArrowLeft" | "ArrowRight", target: string) => {
    await page.keyboard.press(key)
    await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
    assert.equal(await page.locator(".presentation-stage").getAttribute("data-direction"), key === "ArrowLeft" ? "-1" : "1")
    await page.clock.runFor(300)
    await phase(page, "dwelling")
    assert.equal(await page.locator(".presentation-stage").getAttribute("data-paused"), "true", "Either arrow leaves automatic playback paused")
    assert.equal(await currentPanel(page), target)
    assert.equal(new URL(page.url()).pathname, boardPath(target))
  }
  for (const [initialKey, queuedKey] of [["ArrowLeft", "ArrowRight"], ["ArrowRight", "ArrowLeft"]] as const) {
    await page.keyboard.press(initialKey)
    await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
    await page.clock.runFor(100)
    await page.keyboard.press(queuedKey)
    assert.equal(await page.locator(".presentation-stage").getAttribute("data-paused"), "true")
    await page.clock.runFor(200)
    await page.waitForFunction(direction => {
      const stage = document.querySelector(".presentation-stage")
      return stage?.getAttribute("data-direction") === direction && ["waiting", "sliding"].includes(stage.getAttribute("data-phase") ?? "")
    }, queuedKey === "ArrowLeft" ? "-1" : "1", { timeout: 5000 })
    await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
    await page.clock.runFor(300)
    await phase(page, "dwelling")
    assert.equal(await currentPanel(page), keyboardBoard, "An arrow pressed during a transition runs after that transition")
    assert.equal(await page.locator(".presentation-stage").getAttribute("data-paused"), "true")
  }
  await page.keyboard.press("ArrowLeft")
  await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
  await page.clock.runFor(100)
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Space")
  assert.equal(await page.locator(".presentation-stage").getAttribute("data-paused"), "false")
  await page.clock.runFor(200)
  await page.waitForFunction(() => {
    const stage = document.querySelector(".presentation-stage")
    return stage?.getAttribute("data-direction") === "1" && ["waiting", "sliding"].includes(stage.getAttribute("data-phase") ?? "")
  }, undefined, { timeout: 5000 })
  await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
  await page.clock.runFor(300)
  await phase(page, "dwelling")
  assert.equal(await currentPanel(page), keyboardBoard, "The latest arrow during a transition selects the next direction")
  assert.equal(await page.locator(".presentation-stage").getAttribute("data-paused"), "false", "Space can resume playback before a pending navigation runs")
  await navigateSlide("ArrowLeft", surviving)
  await navigateSlide("ArrowLeft", original)
  await navigateSlide("ArrowLeft", keyboardBoard)
  await navigateSlide("ArrowRight", original)
  await page.screenshot({ path: ".e2e/boards/keyboard-slideshow.png" })
  await page.clock.runFor(30000)
  await phase(page, "dwelling")
  assert.equal(await currentPanel(page), original, "Arrow navigation keeps playback paused until Space is pressed")
  await page.keyboard.press("Space")
  await page.clock.runFor(14999)
  await phase(page, "dwelling")
  assert.equal(await currentPanel(page), original, "Resuming after manual navigation gives the board a full 15 seconds")
  await page.clock.runFor(1)
  await page.locator('.presentation-stage[data-phase="sliding"]').waitFor()
  await page.clock.runFor(300)
  assert.equal(await currentPanel(page), surviving, "Space resumes forward automatic playback after manual navigation")
  let releasePrevious!: () => void
  let previousRequested!: () => void
  const holdPrevious = new Promise<void>(resolve => { releasePrevious = resolve })
  const previousSeen = new Promise<void>(resolve => { previousRequested = resolve })
  let holdingPrevious = true
  await page.route(`**${cardPath(original)}`, async route => {
    if (!holdingPrevious) return route.continue()
    previousRequested()
    await holdPrevious
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Late removed board" }) }).catch(() => {})
  })
  try {
    await page.keyboard.press("ArrowLeft")
    await previousSeen
    await phase(page, "waiting")
    holdingPrevious = false
    await navigateSlide("ArrowRight", keyboardBoard)
    releasePrevious()
    await page.unrouteAll({ behavior: "wait" })
    await navigateSlide("ArrowRight", original)
    assert.equal(await page.evaluate(() => history.length), keyboardHistory, "Arrow navigation replaces the board URL without adding history entries")
  } finally {
    releasePrevious()
    await page.unroute(`**${cardPath(original)}`)
  }
  assert.equal((await api.delete(`/api/boards/${keyboardBoard}`, body({}))).status(), 200)
  await navigateSlide("ArrowLeft", surviving)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.keyboard.press("ArrowLeft")
  await page.waitForFunction(id => document.querySelector(".presentation-stage")?.getAttribute("data-phase") === "dwelling" && document.querySelector(".presentation-panel:not(.presentation-preloaded)")?.getAttribute("data-board-id") === id, original)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Play slideshow" }).waitFor()
  assert.equal(new URL(page.url()).pathname, boardPath(original), "Stopping keyboard playback restores the displayed board")
  console.log(
    "Board browser passed CRUD, navigation, transfer, mobile, map shield, fullscreen fallback, fit and refit, exact timing, hidden dwell/slide, controls, edit gates, reduced motion, empty/error/deleted targets, late responses, keyboard navigation, Space pause/resume and Stop replay"
  )
} finally {
  await context.close()
  await browser.close()
}
