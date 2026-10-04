# Bot display API V1

The browser board displays bot-authored documents. People control card placement, size and removal. A bot controls the title, internal layout and display content. Legacy cards remain visible. No bot forms, chat, actions or arbitrary CSS are supported.

## Connect

Open **Connect your bot** in the board and copy the instruction bundle. The browser sends `POST /api/bot/connection` with its session, a matching Origin, `Content-Type: application/json` and `{}`. Development `LOCAL_UI_MODE=true` uses the local workspace owner. This endpoint rejects every Authorization header, including valid bot tokens. The response is a no-store `BotConnection` object containing `baseUrl`, `token`, `instructions`, `capabilitiesUrl`, `cardUrlTemplate`, `boardsUrl` and `localOnly`.

Tokens are generated automatically and are stable when reopening the dialog. Concurrent connection requests converge to one token per owner. SQLite stores a SHA-256 token hash and an AES-256-GCM encrypted token, bound to the owner. It never stores plaintext tokens. Keep the encryption secret backed up. Set `BOT_TOKEN_SECRET` or use the fallback `NEXTAUTH_SECRET`; changing this secret prevents token recovery and returns an explicit error without replacing the existing credential. JWT sign-in secrets and bot bearer tokens are separate credentials.

The instruction URL defaults to `https://dashboard.momoii.com`. `BOT_PUBLIC_BASE_URL` overrides this default and must be an absolute HTTP(S) origin without credentials, path, query or fragment. `NEXTAUTH_URL` and the request origin do not determine the instruction URL. For local bot development, set `BOT_PUBLIC_BASE_URL` to the local server origin. Loopback URLs work only from the same computer. Configuring an address does not prove a remote bot can reach it.

## Discover and write

Send `Authorization: Bearer <token>` to `GET /api/bot/capabilities`. The response contains a generated recursive JSON schema, limits, each component's schema and validated examples, a complete document example and the cross-field constraints that JSON schema cannot represent. The catalog is generated from the actual Zod validators in `lib/bot-document.ts`.

Send the same bearer token to `GET /api/bot/boards` to list owned boards in creation order. The response is `{boards: [{id,name,isOriginal,createdAt}], originalBoardId}`. Filter by either `?name=<URL-encoded name>` or `?id=<boardId>`. Names ignore capitalization and surrounding spaces. An unmatched filter returns an empty `boards` array. Ask the user to choose or create the missing board instead of silently targeting another board.

Send a complete document as JSON to `PUT /api/bot/cards/<cardId>`. A key matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$` and is scoped to the authenticated owner. A new key returns 201. To choose its initial board, append `?boardId=<boardId>` using an ID from discovery. Omitting `boardId` uses the original board. A missing or foreign initial board returns 404. Existing keys update their current board before interpreting the hint, even if the hint is invalid or references a deleted board. Keys remain unique across the account. Use a different key for each separate card, including cards on different boards. The response includes `card.boardId` and `card.membershipRevision`.

Moving a card in the browser preserves its key, payload, content revision, and dimensions. Later PUTs with that key update the moved card without copying it or changing its geometry. Board deletion removes the cards still on that board. A moved card survives deletion of its former board.

New cards start below existing cards; creation returns 409 if this would exceed the board's maximum y coordinate of 10,000. Ask the user to move or remove cards before retrying. Updates to existing keys remain available at capacity. Replacing the same key returns 200 and keeps the database id, position and size. Equivalent canonical payload retries leave the content revision and accepted-at time unchanged. Changed payloads atomically replace the previous document and increment the revision. No history is retained. A deleted key may be recreated by a later PUT.

The document envelope uses `schemaVersion: "1"`, a title of 1–120 characters, optional ISO datetime `updatedAt`, optional `layout: {direction: "vertical" | "horizontal", gap: "small" | "medium" | "large"}` and a nonempty `components` array. Layout defaults to vertical/medium. `updatedAt` describes the bot's source time. The separate server `acceptedAt` records the last accepted change.

```json
{
  "schemaVersion": "1",
  "title": "Daily summary",
  "updatedAt": "2026-10-04T08:00:00Z",
  "components": [
    { "component": "metric", "value": { "label": "Messages", "value": 69 } },
    {
      "component": "chart",
      "value": {
        "type": "area",
        "xKey": "day",
        "series": [{ "key": "count", "label": "Messages" }],
        "data": [{ "day": "Mon", "count": 22 }, { "day": "Tue", "count": 23 }]
      },
      "options": { "gradient": true, "axes": true }
    }
  ]
}
```

Components are title, paragraph, richtext, image, metric, status, timestamp, list, link, divider, table, map, chart, row, column and grid. Charts support area, bar, line, pie, radar and radial. Options are strict and type-specific. Use the catalog's schemas and examples instead of guessing fields.

Chart keys and table columns use safe unique keys. Chart xKey differs from series keys; every row contains the xKey and finite numeric series values, with no undeclared fields. Pie and radial require exactly one nonnegative series. Pie totals must be positive. Radial bars compare each category on a shared zero-to-maximum scale. Curve and line width apply to area/line, stacking to area/bar, gradient to area, axes/grid to area/bar/line/radar, and donut to pie. Table rows must contain exactly the declared columns.

Richtext is sanitized before storage. Both the raw and sanitized HTML must fit the 12,000-character text limit. Allowed tags are p, br, strong, b, em, i, u, s, sub, sup, blockquote, pre, code, ul, ol, li, h1, h2, h3 and a. Only safe absolute HTTP(S) href and title attributes survive on anchors, with rel noopener noreferrer added. Scripts, styles, events and embedded media are removed. Images and links require absolute HTTP(S) URLs without credentials. Images load in the browser with no referrer. Maps render one coordinate using an OpenStreetMap embed selected by the application; arbitrary iframe URLs are rejected.

## Limits and failures

Bodies are capped at 128 KiB while streaming, even without Content-Length. Limits are 8 component levels, 200 total components, 24 children in any layout (including the root), 200 rows per chart/table, 5 chart series, 20 table columns, 100 list items, 12,000 text characters, 2,048 URL characters and 200 label characters. Every object is strict. Geometry, owner and database id fields are rejected.

| Status | Meaning |
| --- | --- |
| 200 / 201 | Replaced or unchanged / created |
| 400 | Malformed JSON, invalid stable key or invalid initial board ID |
| 401 | Missing or invalid bot token; browser session cannot substitute |
| 403 | Browser connection Origin rejected, or attempted browser title edit on a bot card |
| 404 | New key targets a missing or inaccessible board |
| 409 | No vertical space for a new card; existing keys can still update |
| 413 | Body exceeds 128 KiB |
| 415 | Content-Type must be application/json |
| 422 | Invalid document, with at most 25 `issues: [{path,message}]` |
| 503 | Missing configuration, token recovery failure or unavailable storage |

Rejected writes leave the current document untouched. Fix validation errors before retrying. Transient failures can retry the same key safely. Bot authentication remains mandatory in local UI mode. Bot tokens cannot list browser cards or use browser mutation endpoints in session mode. Local UI mode deliberately permits browser access to the local workspace, so keep the development server loopback-only.

## Verify

Run `node_modules/.bin/tsx scripts/bot-contract.ts` for document normalization and rejection checks. After a production build, run `node_modules/.bin/tsx scripts/bot-smoke.ts` for actual HTTP tests against a fresh temporary SQLite database. It starts production servers for session authentication and token-recovery checks, then an isolated development server for the local-mode case. This exercises concurrent setup and first writes, unchanged retries, owner isolation, geometry preservation, streaming limits and sanitized persistence. It does not use the user's database. The local-mode run writes development output to `.next`; rebuild before a subsequent production start. To verify all cases with development servers before building, set `BOT_SMOKE_DEV=1` explicitly. Use the Node runtime matching the installed better-sqlite3 binary.
