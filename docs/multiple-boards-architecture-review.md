# Pre-implementation architecture review

This review compares proposals before implementation. The implemented contracts are in [the design](multiple-boards-design.md).

The specification is the acceptance contract. Scores are 0–5 in rubric order: database and lifecycle; transfer/bot concurrency; URL/auth/fullscreen architecture; playback lifecycle; UX/geometry/accessibility; and interface depth/verification.

| Candidate | Database | Transfer/bot | URL/auth/fullscreen | Playback | UX/fit | Interfaces/seams | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| Astra | 5 | 5 | 5 | 5 | 5 | 4 | **29/30** |
| Sol | 4 | 3 | 3 | 4 | 5 | 4 | **23/30** |
| Luna | 2 | 2 | 3 | 2 | 2 | 2 | **13/30** |

## Recommendation

Use **Astra** as the base. It is the only candidate that explicitly includes both actual pre-page `proxy.ts` gates: preserving anonymous `/boards/:id` in the login return path and exempting bearer `/api/bot/boards` from the JWT gate while authenticating it in the handler. Its original-board marker survives rename, its membership revision closes the A→B→A stale browser mutation hole, and its playback model keeps the last displayed snapshot visible through prefetch delay, transition, and Stop. The persistent fullscreen host and separate presentation snapshots are a feasible design distinct from Sol's page-linked player; use them deliberately, without adding another persistent editable card store.

Concrete grafts and tightening before implementation:

1. Adopt Sol's concise owner-scoped service surface where it reduces file hopping, while retaining Astra's `membershipRevision`, last-source retry receipt, strict board-scoped browser mutations, and exact public `POST /api/cards/:id/move` body. Keep the bot's existing owner-wide key lookup before validating create-time `boardId`.
2. Use a single explicit definition of board-name normalization throughout migration, create, rename, lookup, and docs. Astra's trimmed display plus lowercase key is implementable; specify the exact Unicode behavior and length once. Original display name must be **Dashboard** and remain renameable. The original marker cannot be inferred from name.
3. In the migration, check `foreign_key_check` results and row-by-row preservation before commit in an isolated fixture; ensure `PRAGMA foreign_keys=OFF` occurs outside any transaction. Verify the complete recreated card table, original indexes, and token untouched. Confirm the user-creation adapter path can provision the original atomically; keep race-safe lazy repair for existing/local owners.
4. Clarify move receipts: `lastMoveSourceBoardId` makes an immediately repeated `{sourceBoardId,destinationBoardId}` idempotent after source deletion, but cannot prove historical exactly-once behavior after an A→B→A cycle. The design acknowledges this limitation. Do not report an arbitrary card already in destination as a successful repeat. Validate destination ownership even for retry before returning card data.
5. Keep Astra's browser auth flow, including root proxy and exact `/boards/:id` callback, plus a direct anonymous deep-link and bearer-discovery test. A shared layout cannot be allowed to erase the leaf return path.
6. Keep Astra's presentation-local snapshot flow and native history replacement only if the current Next 16 guide confirms it. Explicitly reconcile a changed URL with the server-rendered page on Stop and distinguish controller-owned pathname updates from user navigation. This avoids two competing visible canvases while maintaining stable URLs. Keep the fullscreen node unconditional in the shared layout.
7. For deletion and playback, use 404 to skip a captured board, keep empty boards as valid slides, and handle deletion of the current board by advancing to a surviving board or the original. Keep non-404 loading failure visible and stop cleanly. Preserve 15-second visible dwell after each completed 300 ms slide, including reduced motion, and pause both dwell and transition while hidden.
8. Preserve `scale <= 1` in both incoming and outgoing occupied-bounds transforms. Put Stop outside the scaled panels and input shield, reveal it for activity/focus for three seconds, and return focus to Play after Stop. Fullscreen rejection uses the in-window fallback, including a late promise resolution after Stop.

## Candidate-specific findings

**Astra.** Meets the spec's default Dashboard, renameable original, exact move path/body, owner constraints, captured creation-order cycle, 15-second visible dwell, 300 ms slide, one-board behavior, hidden-page pause, Stop restoration, fullscreen fallback, and `scale <= 1`. Its strongest advantage is explicit handling of actual `proxy.ts` behavior and asynchronous playback cancellation. The main implementation risk is its larger state surface (`runId`, request generation, layout snapshot registration, live editor and presentation snapshots). Keep only the specified controller state and one accepted visible snapshot per surface; prove cancellation and URL reconciliation with browser tests. `lastMoveSourceBoardId` is a useful narrow receipt, not a general idempotency key.

**Sol.** Has a feasible distinct player: a read-only two-snapshot presentation surface in a persistent layout while normal dynamic pages load. It gives complete timing, window fallback, transition/hidden handling, Stop restoration, and `scale <= 1`. It misses the root proxy redirect and bot-board bearer whitelist, so deep links and bot discovery fail despite correct leaf routes. Its move idempotency check treats *any* card already at destination as an earlier completion, including a stale or malicious source; it needs an exact receipt/operation marker. `isOriginal` plus partial unique is valid at most once, but the stated generic upsert by partial index needs a concrete SQLite/Prisma implementation. The page/player double loading must be kept from becoming two mutable sources of truth.

**Luna.** The migration creates an `Original` board and explicitly forbids renaming it, contradicting the required default **Dashboard** and renameable original. Its usage uses a board-scoped PATCH for transfer instead of the exact `POST /api/cards/:id/move` contract; the proposed CAS update does not calculate destination placement or enforce the capacity ceiling. It treats merely arriving at destination as a valid repeat. Its state machine starts at 10 seconds with a 500 ms transition instead of 15 seconds and 300 ms, uses `router.push` on automatic advances, has no captured-order/deletion skip details, and stops on fullscreen rejection instead of falling back. Fit omits the `scale <= 1` cap. It also misses both proxy gates. These are contract failures, not cosmetic differences.

## Structural alternatives

The feasible designs are Astra's presentation-local snapshots with history replacement and a layout-owned normal canvas, and Sol's separate read-only presentation snapshots with normal dynamic pages and route replacement. Both keep the browser fullscreen element in an unconditional shared layout. Luna is close to the latter and does not offer a third complete option. Astra is the better synthesis base because it accounts for the actual authentication proxy and preserves the visible playback state through asynchronous route/data changes.
