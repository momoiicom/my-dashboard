import { test } from "@e2e-dev/web"
import { expect } from "e2e"

test("agent creates one persistent card", async ({ app, agent, browser, screen }) => {
  await browser.setCookies([{ url: process.env.E2E_BASE_URL!, name: "next-auth.session-token", value: process.env.E2E_SESSION_TOKEN!, httpOnly: true, sameSite: "Lax", secure: false }])
  await app.open("/")
  await expect(screen.getByRole("heading", "Dashboard")).toBeVisible()
  await agent.act("Create exactly one card titled Trial card, then finish editing.")
  await expect(screen.getByRole("heading", "Trial card", { level: 2 })).toHaveCount(1)
  const cards = () => browser.evaluate(async () => {
    const response = await fetch("/api/cards")
    if (!response.ok) throw new Error(`Card list failed: ${response.status}`)
    return (await response.json()).cards
  })
  const saved = await cards()
  expect(saved).toHaveLength(1)
  expect(saved[0]?.title).toBe("Trial card")
  await browser.reload()
  await expect(screen.getByRole("heading", "Trial card", { level: 2 })).toBeVisible()
  expect(await cards()).toEqual(saved)
  await app.screenshot("agent-persisted-card")
})
