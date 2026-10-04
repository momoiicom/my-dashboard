import { BOT_EXAMPLE, BOT_LIMITS } from "./bot-document"

export type BotConnection = {
  baseUrl: string
  token: string
  instructions: string
  capabilitiesUrl: string
  cardUrlTemplate: string
  localOnly: boolean
}
export function buildBotConnection(
  baseUrl: string,
  token: string
): BotConnection {
  const hostname = new URL(baseUrl).hostname
  const localOnly =
    ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(hostname) ||
    hostname.endsWith(".localhost")
  const capabilitiesUrl = `${baseUrl}/api/bot/capabilities`
  const cardUrlTemplate = `${baseUrl}/api/bot/cards/{cardId}`
  const instructions = `Connect to my read-only visualization board.
Base URL: ${baseUrl}
Authorization: Bearer ${token}
Discover the complete validated component/value/options catalog and JSON schema with GET ${capabilitiesUrl} using that Authorization header.
Create or replace a card with PUT ${cardUrlTemplate}, Authorization above, and Content-Type: application/json. cardId is a stable key matching [A-Za-z0-9][A-Za-z0-9._-]{0,79}. Reuse the same key for updates. Each PUT replaces the complete current document. Identical retries preserve revision and acceptedAt. No payload history is retained.
You own only the card title and internal display components/layout. The user owns placement, size and removal. Never send geometry, owner, database id, forms, chat, actions, arbitrary scripts, CSS or iframe URLs. All displayed content is read-only; ordinary informational links are allowed.
Use schemaVersion "1". Optional updatedAt is your source timestamp; acceptedAt is assigned separately by the server. Omitted layout defaults to vertical/medium.
Valid complete request body:
${JSON.stringify(BOT_EXAMPLE, null, 2)}
Limits: ${JSON.stringify(BOT_LIMITS)}. Components may nest through row, column and grid. Consult capabilities for cross-field chart and table constraints and supported options. Richtext is sanitized before persistence. Maps support one coordinate. Images are loaded by the browser.
Success: 201 created, 200 replaced or unchanged. Errors: 401 invalid/missing Bearer token; 400 malformed JSON or card key; 409 no vertical space for a new card, ask the user to move or remove cards before retrying; 413 body too large; 415 expected JSON; 422 invalid document with issues [{path,message}]; 503 configuration/storage unavailable. Existing card updates remain available at capacity. Rejected requests preserve the previous payload. Correct validation errors before retrying.
${localOnly ? "This is a loopback/local address. A bot on another computer cannot reach it. Run the bot on this computer or configure a reachable BOT_PUBLIC_BASE_URL with the operator. No external reachability has been verified." : "This is the configured service address. Network reachability must be verified from the bot runtime."}
Treat this bearer token as a secret. Do not publish it or put it in card content.`
  return {
    baseUrl,
    token,
    instructions,
    capabilitiesUrl,
    cardUrlTemplate,
    localOnly,
  }
}
