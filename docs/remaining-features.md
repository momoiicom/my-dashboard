# Remaining agreed features

**Implementation update, 2026-10-05:** the per-board appearance phase below is now implemented locally, including server image uploads, author defaults, private viewer overrides, preview, Save, Reset and slideshow rendering. Build, API, desktop/mobile browser and sharing regressions passed. See [appearance verification](appearance-verification.md) for evidence and deployment requirements. The audit below records the earlier main-branch baseline; its unimplemented-settings finding has been resolved. The follow-up also enables account-menu Shares and adds slideshow keyboard controls, Apply to all boards, wallpaper optimization, and Advanced background colors.

Audited 2026-10-05 after `git pull --ff-only origin main` advanced this checkout to `cc0f68c1255e2d7d0cb06a9513c7502380c197dc` (`feat(boards): add private sharing and personal layouts (#10)`). The existing local sharing plan was preserved. This audit compares the conversation requirements and [sharing/appearance plan](private-board-sharing-plan.md) with the implementation; it does not add application features or deploy anything.

## Remaining phase: per-board appearance settings

The agreed settings phase is not implemented. The remaining features are:

1. **Settings controls:** an enabled settings editor for the selected board, with live preview, explicit Save, and Reset.
2. **Background choices:** select/change a background image or choose a solid background color.
3. **Accent color:** choose the color used by interface controls and active states.
4. **Saved author defaults and viewer overrides:** persist the author's appearance per board and private viewer preferences per account and board, across reloads and devices. Viewers inherit current author defaults until they customize their appearance.
5. **Independent appearance reset:** clear a viewer's appearance overrides and restore the author's current defaults without resetting card layout. Provide reset behavior for the author's default appearance as well.
6. **Consistent rendering:** apply effective appearance in normal viewing and slideshow playback, replacing the fixed background and control colors. Keep text, controls, and focus indicators readable, and preserve semantic status colors and the Shared badge.

**Image storage decision, confirmed after this audit:** users upload images to the existing application server. Files use persistent server storage, with asset references in the database. Cloudflare provides CDN delivery and caching where board access rules permit. The appearance phase remains unimplemented, but the image source and storage choice is now settled.

Image delivery must preserve board permissions and private viewer overrides. Private responses bypass shared caching until permission can be checked before serving a cached image. Cloudflare's [default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) excludes `private` and `no-store` responses. Authenticated cache delivery needs verification during implementation; this update does not change Cloudflare configuration.

Evidence: `components/account-menu.tsx:54–58` still renders a disabled Settings item marked TBD. `app/globals.css:95–96` and `:211` hardcode the board and slideshow background; `:59` and `:105–106` hardcode blue control colors. The Prisma schema has board grants and personal card geometry, but no persisted appearance preferences. There is no appearance settings editor or API.

## Already implemented

No missing requirement was found in these agreed feature groups during source inspection:

| Feature group | Coverage found |
| --- | --- |
| Multiple boards | Secondary toolbar tabs, create/rename/delete, protected original board, normalized unique names, stable board URLs and sign-in return paths. |
| Card transfers | Edit-mode board selector, preserved card identity/content/dimensions/bot key, destination placement, membership checks and retry handling. |
| Bot targeting | Owner-scoped board discovery by name/ID and initial card placement; instructions ask for clarification when a named board is absent; updates follow existing cards after transfers. |
| Slideshow | Play icon, 15-second board dwell, horizontal transition, fullscreen/fallback, hidden toolbars, activity-revealed Stop, Escape/exit handling, layout fitting and shared-board support. |
| Private sharing | Author-only Sharing menu and access management, pending email invitations, verified-account binding, protected URLs, shared tab tint/badge/author identity and revocation handling. |
| Personal layouts | Account-specific saved geometry, inheritance until customization, live source content, reset to author layout, isolation and transfer/deletion cleanup. |
| Auto-layout | Explicit edit-mode action, deterministic shelf arrangement without AI, unchanged card dimensions, viewport-aware placement and atomic saves with conflict/capacity handling. |

The account menu's separate **Shares** item also remains disabled/TBD (`components/account-menu.tsx:49–53`). Board-level sharing is implemented through each author's board dropdown. A separate account-wide Shares page was not part of the agreed plan.

## Verification and acceptance boundaries

Independent checks on this revision used Node.js 22.23.3 and temporary test databases:

| Check | Result |
| --- | --- |
| Auto-layout fixed placements and capacity rejection | Passed (`node --import tsx scripts/arrange-test.ts`). |
| Verified Google profile callback and session projection fixtures | Passed (`npm run test:sharing:auth`). |
| Historical database migration and ownership preservation | Passed (`node --import tsx scripts/boards-migration.ts`). |
| Multi-board HTTP/API checks | Passed, including authentication, CRUD, links, isolation, membership fences, transfers, retries, capacity and bot targeting (`node --import tsx scripts/boards-smoke.ts`). |
| Sharing HTTP/API checks | Passed, including private access, geometry isolation, layout conflicts and revocation (`node --import tsx scripts/sharing-smoke.ts`). |
| Production build and TypeScript compilation | Passed with `node node_modules/next/dist/bin/next build --webpack`. The default Turbopack build failed when an internal process could not bind a port (`EPERM`), including its retry. |

Actual Google authorization/code exchange with an invited account remains an external acceptance check. The callback fixture uses supplied profiles and the HTTP checks use locally signed sessions. This is a verification gap, not an absent sharing feature.

Rendered browser checks and native fullscreen were not rerun in this audit. Existing browser evidence is recorded in [multi-board verification](multiple-boards-verification.md) and [sharing verification](sharing-verification.md). Real external bot interpretation was not exercised here; its API contract and supplied instructions are implemented. No production migration or deployment was performed.

## Deferred beyond the agreed version

Public access links, automatic invitation emails, collaborative source-card editing, responsive card sizing, ownership transfer, undo, and board reordering are outside this version. Personal layouts and explicit auto-layout address different screen sizes while responsive card sizing remains deferred. These items are not counted as missing promised features.
