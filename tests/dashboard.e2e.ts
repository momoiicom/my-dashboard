import { test } from "@e2e-dev/web"
import { expect } from "e2e"

test("anonymous visitor reaches login", async ({ app, browser, screen }) => {
  await app.open("/")
  await expect(browser).toHaveURL("/login")
  await expect(screen.getByRole("heading", "Dashboard")).toBeHidden()
  await app.screenshot("anonymous-login")
})

test("signed-in card title and geometry persist after reload", async ({ app, browser, screen }) => {
  const baseUrl = process.env.E2E_BASE_URL!
  await browser.setCookies([{ url: baseUrl, name: "next-auth.session-token", value: process.env.E2E_SESSION_TOKEN!, httpOnly: true, sameSite: "Lax", secure: false }])
  await app.open("/")
  await expect(screen.getByRole("heading", "Dashboard")).toBeVisible()
  await expect(screen.getByText("E2E User")).toBeVisible()

  const cards = () => browser.evaluate(async () => {
    const response = await fetch("/api/cards")
    if (!response.ok) throw new Error(`Card list failed: ${response.status}`)
    return (await response.json()).cards
  })
  expect(await cards()).toEqual([])

  await screen.getByRole("button", "Edit layout").tap()
  const created = browser.waitForResponse("**/api/cards")
  await screen.getByRole("button", "+ Add card").tap()
  expect((await created).status).toBe(201)
  const title = screen.getByRole("textbox", "Card title")
  await expect(title).toHaveCount(1)
  await title.fill("Trial card")
  const renamed = browser.waitForResponse("**/api/cards/*")
  await title.press("Enter")
  expect((await renamed).status).toBe(200)

  const handle = screen.getByRole("button", /Move or resize Trial card/)
  const moved = browser.waitForResponse("**/api/cards/*")
  await handle.press("ArrowRight")
  expect((await moved).status).toBe(200)
  const resized = browser.waitForResponse("**/api/cards/*")
  await handle.press("Shift+ArrowRight")
  expect((await resized).status).toBe(200)
  await screen.getByRole("button", "Done editing").tap()
  await expect(screen.getByRole("heading", "Trial card", { level: 2 })).toHaveCount(1)
  const [saved] = await cards()
  expect(saved).toMatchObject({ title: "Trial card", x: 40, y: 20, width: 340, height: 220 })
  expect((await cards()).length).toBe(1)
  await browser.reload()
  await expect(screen.getByRole("heading", "Trial card", { level: 2 })).toBeVisible()
  expect(await cards()).toEqual([saved])
  await app.screenshot("persisted-card")
})
