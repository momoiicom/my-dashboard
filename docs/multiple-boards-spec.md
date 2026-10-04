# Multiple boards, card transfers, and slideshow playback

## Summary

Add saved boards with permanent URLs, tabs below the main toolbar, and card transfers through an edit-mode dropdown.

Place an icon-only Play button at the right end of the board toolbar. Playback presents each board for 15 seconds, then slides to the next.

## Boards and navigation

- Give every board a stable, opaque ID and canonical URL at `/boards/<boardId>`. Renaming never changes its URL.
- Redirect `/` to the owner’s original board. Preserve board links through sign-in, reload, and browser navigation.
- Support create, rename, and delete. Names are unique within the account, ignoring capitalization and surrounding spaces.
- Keep the original board renameable but undeletable. Confirm deletion of added boards and their cards; deleting the active board opens the original.
- In edit mode, each card shows a board dropdown. A successful transfer removes it from the source canvas and provides a destination link.
- Support keyboard navigation and horizontally scrollable tabs. Board access remains private; sharing permissions come later.

## Persistence, transfers, and bots

- Apply Model the Domain by adding saved boards and required card membership with enforced ownership consistency.
- Migrate existing cards into one original board per owner, preserving IDs, content, geometry, revisions, and tokens. Provision original boards safely for new accounts and local mode.
- Add authenticated board CRUD and board-scoped browser card operations. Reject stale source-board geometry or deletion requests after a transfer.
- Add `POST /api/cards/[id]/move` with `{sourceBoardId, destinationBoardId}`. Atomically authorize and transfer the card, preserving identity, content, size, and bot key while placing it below destination cards.
- Apply Make Operations Idempotent so repeated completed transfers succeed without repositioning. Conflicts or full destinations leave the card unchanged.
- Keep the owner token and owner-wide bot card keys. Add authenticated board discovery by name and ID.
- For new cards, `PUT /api/bot/cards/<key>?boardId=<id>` chooses their initial board. Missing IDs use the original board.
- Existing keys update their current card wherever it has moved, including after its former board is deleted. Responses include the actual board ID.
- Connection instructions teach named targeting, distinct keys for separate cards, and clarification when a requested board is missing. Update capabilities and documentation.

## Slideshow behavior

- Play starts with the selected board, follows tab order, and loops continuously. Include empty boards. With one board, remain in presentation mode without repeated transitions.
- Disable Play during active gestures or queued mutations. Starting playback exits edit mode and hides account navigation and both toolbars.
- Request browser fullscreen directly from the Play click. If unavailable or rejected, present within the browser window.
- Keep the fullscreen element and playback controller in a shared board layout so board changes do not exit fullscreen.
- Following Experience First, fit the occupied card bounds into the viewport, centered with padding and without enlarging above normal scale. Preserve saved geometry and recompute fitting after viewport or card changes.
- Prefetch the next board. Retain the current board until the next is ready, then use a 300 ms horizontal slide. Start its 15-second dwell after the transition completes. Respect reduced-motion preferences.
- Replace the canonical URL on automatic advances without adding browser-history entries.
- Show an icon-only Stop button in the upper-right corner for the first three seconds and whenever pointer movement, wheel activity, touch, or keyboard focus occurs. Hide it after three seconds of inactivity; keep it visible while focused.
- Keep Stop outside the scaled board. Presentation captures pointer activity over cards and embedded maps; content interactions resume after playback.
- Stop or Escape restores normal view on the last fully displayed board and focuses Play. Exiting browser fullscreen also stops playback.
- Pause timing while the page is hidden. Skip deleted boards; loading failures stop playback and display an error. Cancel timers, pending transitions, and stale responses when playback ends or navigation leaves the workspace.

## Verification and defaults

- Test migration preservation, board CRUD, unique names, ownership isolation, original-board protection, and permanent URLs through rename and sign-in.
- Test transfers, retries, capacity failures, concurrent bot updates, and stale source-board mutations. Verify named bot creation followed by transfer and continued updates without duplication.
- Verify 15-second timing, ordering, looping, single/empty boards, fullscreen fallback, fitting, transitions, reduced motion, Stop visibility over maps, Escape, hidden-page timing, and cleanup.
- Inspect rendered desktop/mobile behavior. Run lint, typecheck, build, smoke, bot-contract, bot-smoke, and deterministic browser checks.
- Restore dependencies and read bundled Next.js guides before implementation. Default to creation-order tabs and original-board name “Dashboard.” Playback uses the board list captured when Play starts; board reordering and sharing permissions remain outside this version.
