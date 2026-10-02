# My dashboard

A private Next.js dashboard. Google sign-in creates a user and OAuth account in SQLite. Signed-in users can edit their layout to add, title, drag, resize, and remove their own cards. Card positions and sizes persist in SQLite. Every page and API path requires a signed session, except the login page, NextAuth routes, and framework assets.

## Run locally

1. Run `npm install` and `cp .env.example .env.local`.
2. Set `NEXTAUTH_SECRET` in `.env.local` to the output of `openssl rand -base64 32`.
3. Create a Google OAuth client of type **Web application** in Google Cloud Console. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI. Put its client ID and secret in `.env.local`.
4. Run `npm run db:generate` and `npm run db:deploy` to create the local SQLite database.
5. Run `npm run dev` and open `http://localhost:3000`.

Until the Google credentials are set, `/login` shows a disabled sign-in button. The app never supplies test credentials or bypasses Google OAuth. A real Google sign-in needs credentials from your own Google Cloud project.

`DATABASE_URL` defaults to `file:./dev.db` in `.env.example`. Keep the SQLite file on persistent storage if you deploy the site. `NEXTAUTH_URL` must match the public site URL, and the Google callback URI must match that URL plus `/api/auth/callback/google`.

## Check the app

Run `npm run lint`, `npm run typecheck`, and `npm run build`. Then run `npm run test:smoke`. The smoke script creates a temporary SQLite database, applies the checked-in migrations, tests the Prisma adapter's user and Google account writes, and starts the production server to check anonymous redirects, rejected forged cookies, auth route access, signed-session rendering, card CRUD, persisted geometry, cross-user isolation, and input and origin guards. It removes its test records and database afterward. The signed test session is local verification; it does not replace a Google OAuth callback test.

With Node.js 22.12 or newer, install Chromium once with `npx playwright install chromium`. Run `npm run test:e2e` for the local browser trial. The command builds with a generated auth secret and isolated SQLite URL, then starts a production server on a temporary loopback port. It checks the anonymous login gate and uses a signed local test session to create a card, change its title, move and resize it by keyboard, and verify the saved record after reload.

Sign in once with `npx e2e login openai`, then run `npm run test:e2e:agent`. The ChatGPT-backed test runs twice, each time against a fresh database and session. It uses `gpt-6-luna` by default; set `E2E_MODEL` to select another model listed by `npx e2e models openai`. Both runs share `.e2e/cache`. Inspect `.e2e/agent-first/report.json` and `.e2e/agent-replay/report.json` for model calls and cache outcomes. Inspect recordings with `npx e2e cache ls --config e2e.cache.config.ts`. To measure a new recording, run `npx e2e cache clear --config e2e.cache.config.ts` before the agent command again. The cache config does not require trial credentials.

Both commands keep reports and screenshots under `.e2e/` and remove their temporary databases and servers. They verify a signed local session and do not test the Google OAuth callback.

The UI components come from [shadcn/ui](https://ui.shadcn.com/). Cards use free-positioned [react-rnd](https://github.com/bokuweb/react-rnd). The dashboard opens in view mode. Select **Edit layout** to show the 20px dot grid and enable card changes, then **Done editing** to freeze the layout. In edit mode, drag a card's header or resize from its lower-right corner; positions and sizes snap to 20px increments. For keyboard use, focus the card header and press arrow keys to move by 20px or Shift+arrow keys to resize by 20px. The canvas scrolls to reach saved cards on smaller screens. Add more UI components with `npx shadcn@latest add <component>`.

On an existing installation, run `npm run db:deploy` before starting the updated app. Card records belong to the Google user ID. Card mutation requests use JSON and a matching Origin header.

The package overrides pin patched `deepmerge-ts` and `mysql2` versions used by the Prisma CLI. Check whether these overrides are still needed when upgrading Prisma.
