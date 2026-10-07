import {
  BotHttpError,
  botError,
  botResponse,
  parseBotDocument,
  putBotCard,
  readBotJson,
  requireBotOwner,
} from "@/lib/bot-service"
import { notifyCardUpdate } from "@/lib/push-service"
export const runtime = "nodejs"
function notificationIntent(url: string) {
  const values = new URL(url).searchParams.getAll("notify")
  if (values.length > 1 || (values.length === 1 && !["true", "false"].includes(values[0])))
    throw new BotHttpError(400, "notify must be true or false exactly once")
  return values[0] === "true"
}
export async function PUT(
  request: Request,
  context: { params: Promise<{ cardId: string }> }
) {
  try {
    const ownerId = await requireBotOwner(request)
    const notify = notificationIntent(request.url)
    const { cardId } = await context.params
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(cardId))
      throw new BotHttpError(400, "Invalid stable card key")
    const result = await putBotCard(
      ownerId,
      cardId,
      parseBotDocument(await readBotJson(request)),
      new URL(request.url).searchParams.get("boardId")
    )
    const notification = notify ? await notifyCardUpdate(ownerId, result) : undefined
    return botResponse({ card: result.card, ...(notification && { notification }) }, result.change === "created" ? 201 : 200)
  } catch (error) {
    return botError(error)
  }
}
