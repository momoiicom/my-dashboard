# Board appearance verification

This record covers the local implementation on 2026-10-05. The checks used Node 22, temporary SQLite databases, temporary upload directories, a production Next.js server on loopback, and signed test sessions for an author and two invited viewers.

## Commands and results

| Command | Result |
| --- | --- |
| `npx prisma validate` and `npx prisma generate` | Passed. |
| `next build --webpack` | Passed with the appearance and private asset routes. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with one existing `bot-card-renderer.tsx` image warning. |
| `npm run test:appearance:api` | Passed. |
| `npm run test:e2e:appearance` | Passed, including the API suite and desktop/mobile Chromium checks. |
| `npm run test:boards:api` | Passed. |
| `npm run test:sharing:api` | Passed. |
| `node --import tsx scripts/boards-migration.ts` | Passed. The `tsx` CLI cannot create its IPC pipe in the restricted sandbox. |

The appearance API suite checks inheritance, independent viewer fields, reset against current author defaults, stale revision rejection, a failed database write with file rollback, immutable image URLs, cross-board and cross-viewer denial, revocation, and unchanged card content and layout tokens. It uploads a decodable PNG, rejects SVG, invalid bytes, APNG, files over 10 MiB and oversized chunked requests, then checks normalized WebP bytes and private response headers. It deletes a board with author and viewer image references, runs delayed cleanup against orphan files, and verifies that referenced images survive cleanup. The suite also confirms that upload and appearance changes leave the author and viewer card snapshots intact.

The browser suite selects a PNG larger than 10 MiB, verifies that selection makes no upload request, and inspects the actual multipart Save. The uploaded file must be a smaller WebP at 4,096 by 2,731 pixels with no EXIF metadata. The stored server asset must retain those dimensions. A rotated JPEG verifies portrait dimensions and the actual red and blue pixels after orientation. Animated PNG and WebP, excessive source dimensions and files above 50 MiB must preserve the previous valid preview. A delayed native decode verifies that Save is disabled and Reset cannot be replaced by a late result. Desktop and mobile screenshots capture the optimized preview.

The browser suite checks Settings for the selected board, local object URL preview, selecting the same image after Reset, Cancel, Save and reload, author defaults, two independent viewers, mobile layout, conflict with explicit reapply, closing a delayed Reload, and closing a stalled Save. Computed control colors meet a 4.5:1 WCAG contrast ratio for white, black and `#757575` accents. The saved light accent and pressed layout button also meet that ratio. The black accent edit view keeps a white resize grip. During slideshow advance, both outgoing and incoming panels expose their own computed backgrounds; the second board then renders with its own solid color.

## Rendered samples

- [Author image preview](images/appearance/author-image-preview-desktop.png), [saved uploaded image](images/appearance/author-uploaded-desktop.png), [light background preview](images/appearance/author-preview-desktop.png), [saved dark board](images/appearance/author-saved-desktop.png), [black accent while editing](images/appearance/author-black-edit-desktop.png).
- [Viewer personal desktop board](images/appearance/viewer-personal-desktop.png), [inherited mobile board](images/appearance/viewer-inherited-mobile.png), [mobile settings preview](images/appearance/viewer-preview-mobile.png).
- [First slideshow board](images/appearance/slideshow-first-desktop.png), [second slideshow board](images/appearance/slideshow-second-desktop.png), [mobile slideshow](images/appearance/slideshow-mobile.png).

The browser suite writes its original captures to `.e2e/appearance/`. The copies above are kept with the repository for review.

## Integration verification

The feature commit `dc70deb8806a39e4752ed77577f21fd2eccce444` was fast-forwarded into the primary checkout. Independent checks there passed Prisma client generation, the Webpack production build (including TypeScript), the appearance HTTP suite, the existing sharing HTTP suite, and lint with only the existing image warning. The rendered desktop, mobile, uploaded-image and second-board slideshow captures were also inspected. No production database was migrated.

## Appearance migration regression

The pre-PR review found that rebuilding `Board` dropped its existing original-owner check. The migration now preserves `Board_original_owner_check`, which requires `originalOwnerId` to be null or equal to `ownerId`.

The migration regression runs Prisma deployments in three stages. It creates legacy records, applies boards and sharing, seeds a grant and a private card layout, then applies appearance and all subsequent migrations. It compares complete existing board, card, token, grant and layout records after the final deployment and checks default appearance values. It rejects mismatched original owners on insert and update, accepts valid original and secondary boards, checks the three retained unique indexes, and verifies both Board foreign keys and the appearance-shape constraint.

With Node 22.23.3, `node --import tsx scripts/boards-migration.ts` failed before the fix with `Missing expected exception: The final migration must reject an original board owned by another user`. After restoring the SQL check, it passed with `Board migrations preserved historic records, grants, and layouts and enforced ownership through appearance migration`. Focused ESLint and `git diff --check` also passed. These checks used temporary SQLite databases and did not apply production migrations.

## CI browser synchronization regression

The first branch CI run failed while waiting for the second viewer's Settings dialog to close after Save. The test waited for the shared background to become `#112233`, but the author then saved two more accent changes without changing that background. A viewer could satisfy the color assertion while still holding an older appearance revision.

A local Chromium reproduction stopped the second viewer's cards polls after it received the first solid background. The author saved black and then the original gold accent. The existing background assertion passed, but the viewer Save returned HTTP 409 with `Appearance changed on another device`. This confirms that the app correctly rejected a stale save.

The browser test now reads the current viewer appearance revision and waits for the viewer's own cards poll to return that revision before opening Settings. It also asserts HTTP 200 for the viewer Save. The existing conflict and explicit reapply checks remain intact.

With the same deliberately delayed viewer polls released at the new synchronization point, the complete appearance API and browser suite passed on Node 22.23.3. The run used a temporary database, a temporary upload directory, and a loopback production server. Focused ESLint, TypeScript, and `git diff --check` passed. The reproduction instrumentation was removed, and a second complete `npm run test:e2e:appearance` run passed against the final script.

## Deployment checks still needed

The signed sessions do not prove a real Google OAuth callback. The tests do not reach a live Cloudflare edge. Before deployment, put `APPEARANCE_STORAGE_DIR` on persistent storage, back up that directory with the SQLite database, run `appearance:cleanup` on a schedule, and verify that the CDN honors `private, no-store` and never serves a revoked image from a shared cache. No Cloudflare configuration or production storage was changed here.

## Apply to all boards verification

On 2026-10-05, the Node 22 Webpack production build (including TypeScript), focused ESLint, and `git diff --check` passed. The default Turbopack build inside the sandbox could not bind its compiler port; the Webpack build completed. `node --import tsx scripts/appearance-smoke.ts --browser` passed using a temporary database, upload directory, isolated signed accounts, and a loopback production server.

The expanded HTTP suite verifies a mixed owned/shared target set, defaults reaching invited viewers, private shared-board overrides, upload and existing-image copies with separate asset IDs and matching bytes, unchanged remote author defaults, inheritance without copying shared author data, stale-token rejection without files or partial writes, rollback after earlier boards have been updated in the transaction, staged-file cleanup, revoked access, and a changed board set.

The desktop/mobile browser suite verifies the unchecked default, cancellation without other-board changes, image and accent application to both owned boards, a concurrent destination change with Reapply, and private viewer settings applied to owned and shared boards. The rendered `apply-all-desktop.png` and `apply-all-mobile.png` captures under `.e2e/appearance` were inspected. No production database, upload storage, or Cloudflare configuration was changed.

## Automatic and Advanced colors verification

The Node 22 Webpack build, TypeScript, Prisma validation, and ESLint pass. Lint retains the existing bot image warning. `node --import tsx scripts/appearance-migration.ts` preserves complete existing author and viewer records, appearance revisions, and foreign keys. It also checks all eight new database color constraints. The historical `boards-migration.ts` suite passes with the new nullable columns.

`node --import tsx scripts/appearance-smoke.ts --browser` passes. The HTTP checks cover author manual colors, private viewer custom and automatic choices, inheritance after author changes, Reset, legacy saves without colors, invalid maps, mixed-role Apply to all, stale tokens, and transaction rollback after a destination failure.

The real Chromium checks verify distinct automatic toolbar tones for six accents, exact manual backgrounds, valid preview after invalid input, Save and reload, private overrides, Reset, the Shared badge, and slideshow cards. Computed primary and muted text, links, table headers, code blocks, and semantic badges meet 4.5:1 contrast on light and mid-gray custom backgrounds. Color measurements wait for built-in CSS transitions to finish. A separate palette sweep checks all 256 grays and a 216-color RGB grid with 13,746 assertions and no failures.

The final [desktop Advanced editor](images/appearance/advanced-colors-desktop.png), [mobile viewer editor](images/appearance/advanced-colors-mobile.png), and [custom cards in slideshow](images/appearance/advanced-colors-slideshow.png) were inspected. The desktop and mobile layouts fit their viewports and keep Save, Reset, and Cancel reachable through the dialog scroll.

The wallpaper test prepares a 46,164,873-byte source image as a 6,773,178-byte WebP before upload. It verifies photo orientation, dimensions, invalid images, and late Reset behavior. The sharing HTTP and browser checks also pass, including author-only account-menu Shares. The additive Advanced migration remains unapplied in production.

`node --import tsx scripts/e2e.ts boards` passes with the normal Turbopack production build and an isolated browser server. The build retains the existing dynamic filesystem tracing warning. The regression checks exact dwell timing, left and right wraparound, arrow-induced pause, Space pause and resume, remaining dwell time, repeated keydown, reverse transitions, canceled target loads, deleted boards, reduced motion, unchanged history length, and restoration of the displayed board after Stop.

## Slideshow transition input regression

PR review found that an arrow pressed during a slide paused playback but discarded the requested direction. The new Chromium regression failed on the unchanged application with `page.waitForFunction: Timeout 5000ms exceeded` while waiting for the deferred navigation. The hook now retains the latest direction, invalidates stale target loads immediately, and navigates after the current slide commits its board and URL. It preserves the latest pause state, including Space resume before settlement.

The complete `node --import tsx scripts/e2e.ts boards` run passes with the fix. New cases cover both arrow directions during a transition, rapid direction replacement, and Space resume before the queued move. Existing hidden-tab, Stop, canceled-load, reduced-motion and history checks also pass. The production build, TypeScript, focused ESLint and `git diff --check` pass. The rendered paused slideshow was inspected. These checks used a temporary database and loopback server; no production changes were made.
