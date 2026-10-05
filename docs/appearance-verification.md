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

## Deployment checks still needed

The signed sessions do not prove a real Google OAuth callback. The tests do not reach a live Cloudflare edge. Before deployment, put `APPEARANCE_STORAGE_DIR` on persistent storage, back up that directory with the SQLite database, run `appearance:cleanup` on a schedule, and verify that the CDN honors `private, no-store` and never serves a revoked image from a shared cache. No Cloudflare configuration or production storage was changed here.
