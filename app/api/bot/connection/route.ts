import { cardOwnerId } from "@/lib/card-route"
import {
  BotHttpError,
  botError,
  botResponse,
  connectionForOwner,
  readBotJson,
} from "@/lib/bot-service"
export const runtime = "nodejs"
export async function POST(request: Request) {
  try {
    if (request.headers.has("authorization"))
      throw new BotHttpError(401, "Use the browser session to connect a bot")
    const ownerId = await cardOwnerId()
    if (!ownerId) throw new BotHttpError(401, "Browser sign-in is required")
    const origin = new URL(process.env.NEXTAUTH_URL || request.url).origin
    if (request.headers.get("origin") !== origin)
      throw new BotHttpError(403, "Forbidden origin")
    const body = await readBotJson(request)
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      throw new BotHttpError(400, "Expected an empty JSON object")
    return botResponse(await connectionForOwner(ownerId))
  } catch (error) {
    return botError(error)
  }
}
