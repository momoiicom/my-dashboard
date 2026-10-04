import { test } from "@e2e-dev/web"
import { expect } from "e2e"

const signIn = (browser: { setCookies: (cookies: Array<{ url: string; name: string; value: string; httpOnly: boolean; sameSite: "Lax"; secure: boolean }>) => Promise<unknown> }) => browser.setCookies([{ url: process.env.E2E_BASE_URL!, name: "next-auth.session-token", value: process.env.E2E_SESSION_TOKEN!, httpOnly: true, sameSite: "Lax", secure: false }])

const documentFor = (title: string, value: number) => ({ schemaVersion: "1", title, updatedAt: "2026-10-04T12:00:00Z", components: [{ component: "metric", value: { label: "Requests", value, detail: "Today" } }, { component: "chart", value: { type: "area", xKey: "day", series: [{ key: "requests", label: "Requests" }], data: [{ day: "Mon", requests: value - 1 }, { day: "Tue", requests: value }] }, options: { gradient: true, axes: true, grid: true } }, { component: "chart", value: { type: "pie", xKey: "categoryKey", series: [{ key: "fill", label: "Count" }], data: [{ categoryKey: "Alpha", fill: 2 }, { categoryKey: "Beta", fill: 3 }] } }, { component: "chart", value: { type: "radial", xKey: "fill", series: [{ key: "categoryKey", label: "Count" }], data: [{ fill: "First", categoryKey: 2 }, { fill: "Second", categoryKey: 4 }] } }] })

test("anonymous visitor reaches login", async ({ app, browser, screen }) => {
  await app.open("/")
  await expect(browser).toHaveURL(/\/login\?callbackUrl=%2F$/)
  await expect(screen.getByRole("heading", "Dashboard")).toBeHidden()
  await app.screenshot("anonymous-login")
})

test("owner connects a bot and updates a card without losing geometry", async ({ app, browser, screen }) => {
  await signIn(browser)
  await app.open("/")
  await expect(screen.getByRole("dialog", "Connect your bot")).toBeVisible()
  await expect(screen.getByRole("textbox", "Bot instructions")).toBeVisible()
  const bundle = await screen.getByRole("textbox", "Bot instructions").inputValue()
  expect(bundle).toContain("Bearer")
  expect(bundle).toContain("/api/bot/capabilities")
  expect(bundle).toContain("/api/bot/cards/")
  await screen.getByRole("button", "Copy instructions").tap()
  await expect(screen.getByText(/^(Copied|Automatic copy is unavailable\. Select and copy the instructions below\.)$/)).toBeVisible()
  const copyResult = await browser.evaluate(async () => {
    const instructions = (document.querySelector('[aria-label="Bot instructions"]') as HTMLTextAreaElement).value
    let clipboardMatches: boolean | null = null
    try { clipboardMatches = (await navigator.clipboard.readText()) === instructions } catch {}
    return { clipboardMatches, copied: [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Copied"), fallback: document.body.textContent?.includes("Automatic copy is unavailable") ?? false }
  })
  if (copyResult.clipboardMatches === true) expect(copyResult.copied).toBe(true)
  else if (copyResult.clipboardMatches === false) expect(copyResult.fallback).toBe(true)
  else expect(copyResult.copied || copyResult.fallback).toBe(true)
  await expect(screen.getByText(/Select the text above to copy it manually/)).toBeVisible()
  await screen.getByRole("button", "Close").last().tap()
  await expect(screen.getByRole("heading", "Dashboard")).toBeVisible()
  await screen.getByRole("button", "Connect your bot").tap()
  await expect(screen.getByRole("textbox", "Bot instructions")).toBeVisible()
  await screen.getByRole("button", "Close").last().tap()

  const created = await browser.evaluate(async (payload) => {
    const connection = await fetch("/api/bot/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json()) as { token: string }
    const response = await fetch("/api/bot/cards/e2e-service", { method: "PUT", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    return response.status
  }, JSON.parse(JSON.stringify(documentFor("Service health", 1240))))
  expect(created).toBe(201)
  await expect(screen.getByRole("heading", "Service health", { level: 2 })).toBeVisible()
  await expect(screen.getByText("1240").first()).toBeVisible()
  await expect.poll(() => browser.evaluate(() => {
    const paths = [...document.querySelectorAll(".recharts-pie-sector path")].map((path) => path.getAttribute("d"))
    return { pie: paths.length, valid: paths.every((path) => path && !path.includes("NaN")), radialLabels: [...document.querySelectorAll(".recharts-label-list text")].map((label) => label.textContent) }
  })).toEqual({ pie: 2, valid: true, radialLabels: ["First", "Second"] })
  await expect(screen.getByText(/Bot updated/)).toBeVisible()
  await expect(screen.getByText(/Accepted/)).toBeVisible()
  await expect(screen.getByRole("textbox", "Card title")).toHaveCount(0)
  await expect(screen.getByRole("button", "+ Add card")).toHaveCount(0)

  await screen.getByRole("button", "Edit layout").tap()
  const handle = screen.getByRole("button", /Move or resize Service health/)
  const moved = browser.waitForResponse("**/api/boards/*/cards/*")
  await handle.press("ArrowRight")
  expect((await moved).status).toBe(200)
  const resized = browser.waitForResponse("**/api/boards/*/cards/*")
  await handle.press("Shift+ArrowRight")
  expect((await resized).status).toBe(200)
  await screen.getByRole("button", "Done editing").tap()
  const before = await browser.evaluate(async () => (await (await fetch(`/api/boards/${location.pathname.split("/").at(-1)}/cards`)).json()).cards[0]) as { id: string; x: number; width: number }
  expect(before.x).toBe(40)
  expect(before.width).toBe(500)

  const replaced = await browser.evaluate(async (payload) => {
    const connection = await fetch("/api/bot/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json()) as { token: string }
    const send = () => fetch("/api/bot/cards/e2e-service", { method: "PUT", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    return [(await send()).status, (await send()).status]
  }, JSON.parse(JSON.stringify(documentFor("Service health updated", 1300))))
  expect(replaced).toEqual([200, 200])
  await expect(screen.getByRole("heading", "Service health updated", { level: 2 })).toBeVisible()
  await expect(screen.getByText("1300").first()).toBeVisible()
  const after = await browser.evaluate(async () => (await (await fetch(`/api/boards/${location.pathname.split("/").at(-1)}/cards`)).json()).cards[0]) as { id: string; x: number; width: number }
  expect(after.id).toBe(before.id)
  expect(after.x).toBe(before.x)
  expect(after.width).toBe(before.width)
  await browser.reload()
  await expect(screen.getByRole("heading", "Service health updated", { level: 2 })).toBeVisible()
  await app.screenshot("bot-card-persisted")
  await browser.evaluate(() => {
    const state = window as typeof window & { heldBotPoll?: boolean; releaseBotPoll?: () => void }
    const original = window.fetch
    let intercepted = false
    window.fetch = async (...args) => {
      if (!intercepted && String(args[0]).startsWith("/api/boards/") && String(args[0]).endsWith("/cards") && !args[1]?.method) {
        intercepted = true
        const response = await original(...args)
        state.heldBotPoll = true
        return new Promise<Response>((resolve) => { state.releaseBotPoll = () => { window.fetch = original; resolve(response) } })
      }
      return original(...args)
    }
    return true
  })
  await expect.poll(() => browser.evaluate(() => Boolean((window as Window & { heldBotPoll?: boolean }).heldBotPoll))).toBe(true)
  await screen.getByRole("button", "Edit layout").tap()
  const removed = browser.waitForResponse("**/api/boards/*/cards/*")
  await screen.getByRole("button", "Remove Service health updated").tap()
  expect((await removed).status).toBe(200)
  const retainedAfterOldPoll = await browser.evaluate(async () => {
    ;(window as Window & { releaseBotPoll?: () => void }).releaseBotPoll?.()
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    return [...document.querySelectorAll("h2")].filter((heading) => heading.textContent === "Service health updated").length
  })
  expect(retainedAfterOldPoll).toBe(0)
  expect(await browser.evaluate(async () => (await (await fetch(`/api/boards/${location.pathname.split("/").at(-1)}/cards`)).json()).cards.length)).toBe(0)
})
