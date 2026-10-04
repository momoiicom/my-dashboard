import { test } from "@e2e-dev/web"
import { expect } from "e2e"

test("bot connection is discoverable and card content is read only", async ({ app, agent, browser, screen }) => {
  await browser.setCookies([{ url: process.env.E2E_BASE_URL!, name: "next-auth.session-token", value: process.env.E2E_SESSION_TOKEN!, httpOnly: true, sameSite: "Lax", secure: false }])
  await app.open("/")
  await expect(screen.getByRole("dialog", "Connect your bot")).toBeVisible()
  await agent.act("Find how to connect a bot. Open the connection dialog if needed, read the instructions, then close the dialog. Do not create or edit a card.")
  await expect(screen.getByRole("button", "Connect your bot")).toBeVisible()
  await expect(screen.getByRole("textbox", "Card title")).toHaveCount(0)
  await expect(screen.getByRole("button", "+ Add card")).toHaveCount(0)
  await app.screenshot("bot-connection")
})
