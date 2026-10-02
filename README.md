# My dashboard

A bare private Next.js site. Google sign-in creates a user and OAuth account in SQLite. Every page and API path requires a signed session, except the login page, NextAuth routes, and framework assets.

## Run locally

1. Run `npm install` and `cp .env.example .env.local`.
2. Set `NEXTAUTH_SECRET` in `.env.local` to the output of `openssl rand -base64 32`.
3. Create a Google OAuth client of type **Web application** in Google Cloud Console. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI. Put its client ID and secret in `.env.local`.
4. Run `npm run db:generate` and `npm run db:deploy` to create the local SQLite database.
5. Run `npm run dev` and open `http://localhost:3000`.

Until the Google credentials are set, `/login` shows a disabled sign-in button. The app never supplies test credentials or bypasses Google OAuth. A real Google sign-in needs credentials from your own Google Cloud project.

`DATABASE_URL` defaults to `file:./dev.db` in `.env.example`. Keep the SQLite file on persistent storage if you deploy the site. `NEXTAUTH_URL` must match the public site URL, and the Google callback URI must match that URL plus `/api/auth/callback/google`.

## Check the app

Run `npm run lint`, `npm run typecheck`, and `npm run build`. Then run `npm run test:smoke`. The smoke script creates a temporary SQLite database, applies the checked-in migration, tests the Prisma adapter's user and Google account writes, and starts the production server to check anonymous redirects, rejected forged cookies, auth route access, and signed-session rendering. It removes its test records and database afterward. The signed test session is local verification; it does not replace a Google OAuth callback test.

The UI components come from [shadcn/ui](https://ui.shadcn.com/). Add more with `npx shadcn@latest add <component>`.

The package overrides pin patched `deepmerge-ts` and `mysql2` versions used by the Prisma CLI. Check whether these overrides are still needed when upgrading Prisma.
