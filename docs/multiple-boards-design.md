# Multiple boards design

Boards belong to an account. Cards belong to exactly one of that account's boards. The original board has a stable identity even after a rename. Bot keys remain unique across the account.

## Persistence and types

`Board` stores an opaque `b_` plus 32 hexadecimal character ID, `ownerId`, `name`, `nameKey`, nullable unique `originalOwnerId`, and timestamps. The original board stores its owner ID in `originalOwnerId`. Other boards store null. A database check requires a non-null original owner to equal the owner. A composite card foreign key references `(Board.ownerId, Board.id)`. This enforces ownership consistency without relying on route checks.

Names are trimmed and contain at most 120 Unicode code points. The unique account key is the trimmed name converted to lowercase. Internal whitespace is preserved. Original provisioning uses a unique-key upsert without changing an existing name. Migration provisions every existing user, including users with no cards. Existing card fields and tokens remain unchanged. New boards receive a timestamp later than the last board in the account, within the create transaction. Rapid inserts and a backward wall clock cannot reorder tabs.

`DashboardCard` adds required `boardId`, `membershipRevision` defaulting to zero, and nullable `lastMoveSourceBoardId`. The last source is a retry receipt rather than a foreign key. Deleting the old source board must not break completed move retries.

Shared types in `lib/board.ts` are:

```ts
BoardRecord = { id: string; name: string; isOriginal: boolean; createdAt: string }
WorkspaceSnapshot = { boards: BoardRecord[]; originalBoardId: string }
BoardSnapshot = { board: BoardRecord; cards: CardRecord[] }
MoveInput = { sourceBoardId: string; destinationBoardId: string }
MoveResult = { card: CardRecord; moved: boolean }
```

`CardRecord` gains `boardId` and `membershipRevision`. `lastMoveSourceBoardId` stays internal. `boardHref(id)` returns the canonical path. `lib/board-store.ts` owns database board operations. Existing card storage and bot service functions retain their responsibilities.

## HTTP contract

All browser routes require the account session. Writes retain the existing same-origin JSON checks. Reads disable caching. Missing and foreign resources return the same 404 response. Invalid input returns 400. Duplicate names, stale membership, protected deletion, and full destinations return 409. Exhausted database retries return 503.

| Route | Body or query | Success |
| --- | --- | --- |
| GET /api/boards | None | WorkspaceSnapshot |
| POST /api/boards | `{name}` | 201 `{board}` |
| PATCH /api/boards/[boardId] | `{name}` | `{board}` |
| DELETE /api/boards/[boardId] | `{}` | `{originalBoardId}` |
| GET /api/boards/[boardId]/cards | None | BoardSnapshot |
| POST /api/boards/[boardId]/cards | Existing CardInput | 201 `{card}` |
| PATCH /api/boards/[boardId]/cards/[id] | `{patch: CardPatch, membershipRevision}` | `{card}` |
| DELETE /api/boards/[boardId]/cards/[id] | `{membershipRevision}` | Existing successful deletion response |
| POST /api/cards/[id]/move | `{sourceBoardId,destinationBoardId}` | `{card,moved}` |
| GET /api/bot/boards | Optional `name` or `id` | WorkspaceSnapshot, filtered when requested |
| PUT /api/bot/cards/[key] | Existing payload, optional query `boardId` | Existing response plus actual boardId |

Browser mutations check the ID, owner, board, and membership revision in one predicate. This rejects a stale edit even after a card moves away and returns. Migrate browser callers and remove the old unscoped browser card routes together.

A move transaction authorizes the card and destination, recognizes a completed matching source-to-destination retry, and otherwise checks the current source. It computes destination placement below the existing cards, rejects a placement above the existing coordinate limit, and updates membership and position with a revision predicate. The transaction changes no content, size, identity, or bot key. Bounded SQLite write retries recompute placement. A competing transfer returns conflict. The two-ID request records the most recent completed move, not arbitrary historical exactly-once execution.

Bot updates look up an existing account key before validating an initial-board hint. Existing keys update their actual board even when that hint references a deleted board. New keys use an owned specified board or the original board. Concurrent content writes update only bot-owned content fields. Board discovery uses the same name normalization as creation.

## Routing and normal view

The authentication proxy preserves the requested canonical path through login. A shared validator accepts only `/` and canonical board paths. Login uses that value for both an existing-session redirect and the Google callback. Bot board discovery is exempt from the session proxy and still requires its bearer token.

`/` provisions and redirects to the original board. `app/boards/layout.tsx` mounts the persistent client workspace and fullscreen element. The layout loads session and account metadata when available but leaves the exact missing-session redirect to the child page. `app/boards/[boardId]/page.tsx` validates access and loads a snapshot. A tiny route bridge registers that snapshot only when it matches the current path. Next page replacement does not remount the workspace or fullscreen host.

The workspace owns board metadata, selected accepted snapshot, and playback. The editable Dashboard is keyed by board identity. Its existing mutation queue and polling fences stay per board. Queued requests carry the captured board ID and membership revision. Late responses cannot publish into another board. Navigating cancels unsent work and requests. Sent writes may finish on their captured board.

Tabs use canonical Next links in creation order, roving arrow, Home, and End navigation, and horizontal scrolling. Creation, rename, and confirmed deletion update metadata. Background metadata requests carry a version and cannot overwrite a later board mutation. Snapshot registration stays stable across playback start and stop, so an old server page cannot restore a renamed tab. Card transfer dropdowns appear only in edit mode. Successful transfer removes the source card and offers a destination link. Shares and Settings remain disabled.

## Playback lifecycle

The controller has explicit idle, dwelling, waiting, and sliding states with a run generation. A run captures board creation order and starts at the selected board. It never adds newly created boards to that run. Deleted boards are skipped.

The Play handler calls `requestFullscreen` synchronously on the already-mounted host. A rejection continues playback in the window. Starting exits edit mode and hides both bars. Play is disabled while a gesture, transfer, or mutation is pending.

Presentation renders read-only snapshots separately from the editable canvas. It fits occupied bounds into the available viewport with padding, centers them, and caps scale at one. Fitting changes only a view transform. Resize and accepted card updates recompute the transform.

Each fully displayed board receives 15 seconds of visible dwell. The next board is prefetched. The current board remains until the next is ready. A horizontal slide lasts 300 milliseconds, or completes immediately with reduced motion. The next dwell starts after the slide completes. One surviving board stays in presentation without self-transitions. A successful advance replaces the URL using the documented native History integration, without remounting the host or adding history entries.

An input shield covers cards and cross-origin map frames. Stop sits above the shield and outside the fitted canvas. Activity reveals Stop for three seconds. Keyboard focus keeps it visible. Stop, Escape, or fullscreen exit cancels requests, timers, and transitions, restores the last fully displayed board, and focuses Play. A late fullscreen promise cannot restart a stopped run. External navigation cancels the run without overriding the user's destination.

Hidden-page timing preserves the remaining dwell and transition time. Resume has no catch-up advance. A deleted target is skipped. Other loading errors stop playback and appear in the normal view. Every asynchronous result checks its run generation.

## Architecture choice and verification

Three independent architecture candidates were compared before implementation. Astra was the base, scoring 29 of 30 against the contract in the [pre-implementation review](multiple-boards-architecture-review.md). Sol's compact service organization was retained. Luna's different timing, original-board protection, history, and fullscreen behavior were rejected because they contradicted the supplied specification.

Model the Domain changed the schema to required board membership and an explicit playback state model. Make Operations Idempotent added the narrow move receipt and revision predicates. Experience First kept a stable fullscreen host, input capture over maps, and window fallback. Separate Before Serializing Shared State gives each implementation writer a separate worktree.

The acceptance matrix is in `multiple-boards-verification.md`. Migration and database ownership checks precede UI acceptance. Browser checks use isolated databases and sessions. They do not establish a real Google OAuth login. Existing user data and production remain untouched.

Implementation workers read the installed Next guides for layouts, navigation, authentication, and native History before writing framework code. The installed `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` documents native history integration. The layouts guide documents preserved layout state across navigation. Browser fullscreen requires transient activation and announces changes through fullscreenchange. See the [MDN fullscreen reference](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) and [animation pause reference](https://developer.mozilla.org/en-US/docs/Web/API/Animation/pause).
