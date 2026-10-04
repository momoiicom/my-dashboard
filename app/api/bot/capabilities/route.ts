import { getBotCapabilities } from "@/lib/bot-document"
import { botError, botResponse, requireBotOwner } from "@/lib/bot-service"
export const runtime = "nodejs"
export async function GET(request: Request) {
  try {
    await requireBotOwner(request)
    return botResponse(getBotCapabilities())
  } catch (error) {
    return botError(error)
  }
}
