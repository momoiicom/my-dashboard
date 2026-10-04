import {
  BotHttpError,
  botError,
  botResponse,
  parseBotDocument,
  putBotCard,
  readBotJson,
  requireBotOwner,
} from "@/lib/bot-service"
export const runtime = "nodejs"
export async function PUT(
  request: Request,
  context: { params: Promise<{ cardId: string }> }
) {
  try {
    const ownerId = await requireBotOwner(request)
    const { cardId } = await context.params
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(cardId))
      throw new BotHttpError(400, "Invalid stable card key")
    const result = await putBotCard(
      ownerId,
      cardId,
      parseBotDocument(await readBotJson(request))
    )
    return botResponse({ card: result.card }, result.created ? 201 : 200)
  } catch (error) {
    return botError(error)
  }
}
