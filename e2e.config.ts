import { web } from "@e2e-dev/web"
import type { E2EConfig } from "e2e"
import { chatgpt } from "e2e/oauth/chatgpt"
import { cache } from "./e2e.cache.config"

const baseUrl = process.env.E2E_BASE_URL
const sessionToken = process.env.E2E_SESSION_TOKEN
if (!baseUrl || !sessionToken) throw new Error("Run e2e through npm run test:e2e or test:e2e:agent")

export default {
  projectId: "my-dashboard-local-trial",
  targets: [{
    name: "chromium",
    engine: web({ browser: "chromium" }),
    app: { url: baseUrl, identity: "my-dashboard-local-trial" },
  }],
  secrets: { sessionToken },
  agents: { default: { model: chatgpt(process.env.E2E_MODEL ?? "gpt-6-luna"), maxSteps: 12, maxModelCalls: 8 } },
  cache,
  retries: 0,
  workers: 1,
  timeout: 180_000,
} satisfies E2EConfig
