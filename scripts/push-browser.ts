import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"
import type { PrismaClient } from "../generated/prisma/client"

type WorkerScope = typeof globalThis & { registration: ServiceWorkerRegistration; NotificationEvent: new (type: string, init: { notification: Notification }) => Event }

type Fixture = { base: string; cookie: string; otherCookie: string; ownerId: string; endpoint: string; keys: { p256dh: string; auth: string }; prisma: PrismaClient }
export async function verifyPushBrowser(fixture: Fixture) {
 const { base, cookie, otherCookie, endpoint, keys, prisma } = fixture
 await prisma.pushSubscription.deleteMany({})
 const browser = await chromium.launch({ headless: true, channel: "chromium" })
 const context = await browser.newContext({ permissions: ["notifications"], viewport: { width: 1280, height: 900 } })
 await context.grantPermissions(["notifications"], { origin: base })
 await context.addCookies([{ name: "next-auth.session-token", value: cookie.split("=")[1], url: base }])
 await context.addInitScript(`(() => {
  const { endpoint, keys } = ${JSON.stringify({ endpoint, keys })};
  let subscribed = false;
  const counts = { prompts: 0, unsubscribes: 0 };
  window.pushTest = counts;
  Notification.requestPermission = async () => { counts.prompts++; return "granted" };
  const subscription = { endpoint, toJSON: () => ({ endpoint, keys }), unsubscribe: async () => { subscribed = false; counts.unsubscribes++; return true } };
  PushManager.prototype.getSubscription = async () => subscribed ? subscription : null;
  PushManager.prototype.subscribe = async () => { subscribed = true; return subscription };
 })()`)
 const page = await context.newPage()
 page.on("pageerror", error => console.error("Browser error", error.message))
 try {
  await page.goto(base)
  const open = async () => { await page.getByRole("button", { name: /Account menu/ }).click(); await page.getByRole("menuitem", { name: "Notifications", exact: true }).click() }
  await open()
  await page.getByRole("button", { name: "Enable notifications", exact: true }).waitFor()
  assert.equal(await page.evaluate(() => (window as unknown as { pushTest: { prompts: number } }).pushTest.prompts), 0)
  await page.route("**/api/push", async route => {
   if (route.request().method() === "POST") await new Promise(resolve => setTimeout(resolve, 500))
   await route.continue()
  })
  await page.getByRole("button", { name: "Enable notifications", exact: true }).click()
  await page.keyboard.press("Escape")
  assert(await page.getByRole("dialog").isVisible(), "Enrollment cannot race a closing dialog")
  await page.getByText("Notifications are on for this browser.", { exact: true }).waitFor()
  await page.unroute("**/api/push")
  assert.equal(await prisma.pushSubscription.count(), 1)
  await mkdir(".e2e/push", { recursive: true })
  await page.screenshot({ path: ".e2e/push/enabled.png" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: ".e2e/push/mobile.png" })
  assert(await page.getByRole("button", { name: "Disable notifications", exact: true }).isVisible())
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.route("**/api/push", route => route.request().method() === "DELETE" ? route.fulfill({ status: 503, json: { error: "Temporary failure" } }) : route.continue())
  await page.getByRole("button", { name: "Disable notifications", exact: true }).click()
  await page.getByText("Temporary failure", { exact: true }).waitFor()
  assert(await page.getByRole("button", { name: "Disable notifications", exact: true }).isVisible())
  await page.unroute("**/api/push")
  await page.getByRole("button", { name: "Disable notifications", exact: true }).click()
  await page.getByText("Notifications are off for this browser.", { exact: true }).waitFor()
  assert.equal(await prisma.pushSubscription.count(), 0)
  await page.getByRole("button", { name: "Enable notifications", exact: true }).click()
  await page.getByText("Notifications are on for this browser.", { exact: true }).waitFor()
  const cdp = await context.newCDPSession(page)
  let registrationId = ""
  cdp.on("ServiceWorker.workerRegistrationUpdated", event => {
   const registration = event.registrations.find(item => item.scopeURL === base + "/")
   if (registration) registrationId = registration.registrationId
  })
  await cdp.send("ServiceWorker.enable")
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker")
  await worker.evaluate("globalThis.__name = value => value")
  await worker.evaluate(endpoint => {
   Object.defineProperty((self as unknown as WorkerScope).registration.pushManager, "getSubscription", { value: async () => ({ endpoint }) })
  }, endpoint)
  const board = await prisma.board.findFirstOrThrow({ where: { ownerId: fixture.ownerId } })
  const receive = async (payload: unknown) => {
   await worker.evaluate(async () => {
    const scope = self as unknown as WorkerScope
    const prior = await scope.registration.getNotifications(); prior.forEach(notification => notification.close())
   })
   await new Promise(resolve => setTimeout(resolve, 100))
   assert(registrationId, "Registered worker reported by Chromium")
   await cdp.send("ServiceWorker.deliverPushMessage", { origin: base, registrationId, data: JSON.stringify(payload) })
   for (let i = 0; i < 100; i++) {
    const result = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, data: n.data })))
    if (result.length) return result
    await new Promise(resolve => setTimeout(resolve, 50))
   }
   throw new Error("Worker did not publish a visible notification")
  }
  const payload = { ownerId: fixture.ownerId, url: `/boards/${board.id}`, cardId: "c123456789012345678901234", revision: 1 }
  const notices = await receive(payload)
  assert.equal(notices[0].title, "Dashboard updated")
  assert.equal(notices[0].data.path, payload.url)
  assert(!JSON.stringify(notices).includes("Push owner"))
  await context.addCookies([{ name: "next-auth.session-token", value: otherCookie.split("=")[1], url: base }])
  assert.equal((await receive(payload))[0].data.path, "/")
  assert.equal((await receive({ ...payload, url: "https://evil.example" }))[0].data.path, "/")
  const otherBoards = await (await context.request.get(base + "/api/boards")).json()
  await worker.evaluate(async () => {
   const scope = self as unknown as WorkerScope
   const notification = (await scope.registration.getNotifications())[0]
   const event = new scope.NotificationEvent("notificationclick", { notification })
   let completion = Promise.resolve()
   Object.defineProperty(event, "waitUntil", { value: (promise: Promise<void>) => { completion = promise } })
   self.dispatchEvent(event)
   await completion.catch(error => { if (!(error instanceof DOMException) || error.name !== "InvalidAccessError") throw error })
  })
  await page.waitForURL(base + `/boards/${otherBoards.originalBoardId}`)
  await context.addCookies([{ name: "next-auth.session-token", value: cookie.split("=")[1], url: base }])
  await page.goto(base)
  await open()
  await page.getByRole("button", { name: "Enable notifications", exact: true }).click()
  await page.getByText("Notifications are on for this browser.", { exact: true }).waitFor()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /Account menu/ }).click()
  await page.route("**/api/push", async route => {
   if (route.request().method() === "DELETE") { await new Promise(resolve => setTimeout(resolve, 4500)); await route.continue().catch(() => undefined) }
   else await route.continue()
  })
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click()
  await page.waitForURL("**/login", { timeout: 6000 })
  console.log("Push browser verification passed: rendered desktop/mobile controls, no mount prompt, enable, disable retry, disable, signout; real worker and browser showNotification with CDP-delivered push event; private routing and account-switch fallback. PushManager enrollment and notification clicks are simulated. Native provider delivery and native click focus are not verified.")
 } catch (error) { console.error(await page.locator("body").innerText()); throw error } finally { await browser.close() }
}
