# My dashboard

A private Next.js workspace with saved boards for bot-authored display cards. Google sign-in creates a user and OAuth account in SQLite. Connect a bot to create and replace read-only card content. People control card placement, size and removal. Existing cards remain visible. Browser endpoints require a signed session; the bot capability, board-discovery and card-write endpoints always require a separate Bearer token. See [the bot API guide](docs/bot-api.md).

## Run locally

1. Run `npm install` and `cp .env.example .env.local`.
2. Set `NEXTAUTH_SECRET` in `.env.local` to the output of `openssl rand -base64 32`.
3. Create a Google OAuth client of type **Web application** in Google Cloud Console. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI. Put its client ID and secret in `.env.local`.
4. Run `npm run db:generate` and `npm run db:deploy` to create the local SQLite database.
5. Run `npm run dev` and open `http://localhost:3000`.

Until the Google credentials are set, `/login` shows a disabled sign-in button. A real Google sign-in needs credentials from your own Google Cloud project.

For temporary UI work without Google sign-in, set `LOCAL_UI_MODE=true` in `.env.local`, run `npm run db:generate` and `npm run db:deploy`, then start `npm run dev -- --hostname localhost`. The dashboard uses a local workspace user in SQLite, so card edits survive reloads. Remove the flag or set it to `false`, then restart the dev server to restore Google sign-in. The switch only works in development.

`DATABASE_URL` defaults to `file:./dev.db` in `.env.example`. Keep the SQLite file on persistent storage if you deploy the site. `NEXTAUTH_URL` must match the public site URL, and the Google callback URI must match that URL plus `/api/auth/callback/google`.

## Check the app

Run `npm run lint`, `npm run typecheck`, and `npm run build`. Then run `npm run test:smoke`. The smoke script creates a temporary SQLite database, applies the checked-in migrations, tests the Prisma adapter's user and Google account writes, and starts the production server to check anonymous redirects, rejected forged cookies, auth route access, signed-session rendering, card CRUD, persisted geometry, cross-user isolation, and input and origin guards. It removes its test records and database afterward. The signed test session is local verification; it does not replace a Google OAuth callback test.

With Node.js 22.12 or newer, install Chromium once with `npx playwright install chromium`. Run `npm run test:e2e` for the local browser trial. The command builds with a generated auth secret and isolated SQLite URL, then starts a production server on a temporary loopback port. It checks the anonymous login gate and the read-only bot board, onboarding, refresh and persisted layout through a signed local test session.

Sign in once with `npx e2e login openai`, then run `npm run test:e2e:agent`. The ChatGPT-backed test runs twice, each time against a fresh database and session. It uses `gpt-6-luna` by default; set `E2E_MODEL` to select another model listed by `npx e2e models openai`. Both runs share `.e2e/cache`. Inspect `.e2e/agent-first/report.json` and `.e2e/agent-replay/report.json` for model calls and cache outcomes. Inspect recordings with `npx e2e cache ls --config e2e.cache.config.ts`. To measure a new recording, run `npx e2e cache clear --config e2e.cache.config.ts` before the agent command again. The cache config does not require trial credentials.

Both commands keep reports and screenshots under `.e2e/` and remove their temporary databases and servers. They verify a signed local session and do not test the Google OAuth callback.

The UI components come from [shadcn/ui](https://ui.shadcn.com/). Cards use free-positioned [react-rnd](https://github.com/bokuweb/react-rnd). The dashboard opens in view mode. Select **Edit layout** to enable dragging, resizing and removal, then **Done editing** to freeze the layout. Card titles and content are read-only. Keyboard arrow keys move a focused card header; Shift+arrow keys resize it. The canvas scrolls to reach saved cards on smaller screens.

**Connect your bot** provides a stable owner token and a complete copyable instruction bundle. It also opens automatically on an initially empty board and can be dismissed and reopened. Bots can discover boards by name and choose the initial board for each new key. Existing keys follow moved cards. The board periodically discovers bot cards and content updates without changing locally controlled geometry.

On an existing installation, run `npm run db:generate` and `npm run db:deploy` before starting the updated app. The bot migration adds nullable payload fields, revision metadata and encrypted token storage. It preserves existing card records and geometry. The board migration assigns every existing card to its owner's original board and preserves all legacy fields and tokens. Browser card routes are scoped to `/api/boards/<boardId>/cards`; edit and deletion requests include the card's `membershipRevision`. Browser title updates are forbidden on bot cards. Card mutation requests use JSON and a matching Origin header.

For bot verification, run `node_modules/.bin/tsx scripts/bot-contract.ts` and, after a build, `node_modules/.bin/tsx scripts/bot-smoke.ts`. The latter uses temporary databases and isolated servers. Run it separately from a development server in the same working directory. The [API guide](docs/bot-api.md) describes limits, token recovery and production smoke checks.

The package overrides pin patched `deepmerge-ts` and `mysql2` versions used by the Prisma CLI. Check whether these overrides are still needed when upgrading Prisma.

## Saved boards

Use the tabs below the account toolbar to switch boards. The plus, pencil, and trash buttons create, rename, and delete boards. In **Edit layout**, each card has a destination dropdown. A successful transfer removes the card and shows a link to its destination.

Select **Play** to present the selected board, then cycle through the captured tab order. Each board stays visible for 15 seconds before a 300 ms slide. Playback fits the saved layout into the viewport and pauses when the page is hidden. Fullscreen rejection uses the browser window. **Stop**, Escape, or leaving fullscreen restores the last displayed board and focuses Play.

Every board has a permanent `/boards/<boardId>` URL. The root URL opens the original board, initially named Dashboard. Names are unique within the account after trimming and ignoring case. Renaming preserves the URL. The original board can be renamed but cannot be deleted. Deleting another board removes its remaining cards.

Browser mutations require a signed session, a matching Origin header, and JSON. Board CRUD uses `/api/boards` and `/api/boards/<boardId>`. To transfer a card, send `POST /api/cards/<id>/move` with `{sourceBoardId,destinationBoardId}`. A transfer preserves content and dimensions, places the card below the destination cards, and increments its membership revision. Retrying the most recently completed transfer does not move it again, including after the old board is deleted. A full destination returns 409 without changing the card.

Card edits and deletions compare the captured board and membership revision, so a queued request cannot edit a card that has moved away and returned. Missing or foreign resources return 404. Duplicate board names, original-board deletion, and stale membership return 409. Transient storage exhaustion returns 503 and can be retried.

Run `npm run test:boards:migration` for legacy preservation and database ownership constraints. After a build, run `npm run test:boards:api` for board, transfer, and bot contracts. Run `npm run test:e2e:boards` for the isolated browser suite. See [the acceptance evidence](docs/multiple-boards-verification.md) for coverage and manual verification boundaries.
