# Private board sharing and auto-layout

## Goal and prerequisite

Let the author share a live board with invited accounts. Each viewer can arrange its cards for their screen without changing the author’s layout or another viewer’s layout. Auto-layout calculates positions in the app and requires no bot, AI model, or API key.

Start implementation after the other thread’s multi-board work is finished and integrated. Reuse its board model, permanent `/boards/<boardId>` URLs, board tabs, transfer behavior, browser APIs, and slideshow controller. Do not rebuild those features. This checkout still has the single-board model at the time this plan is written. Reconcile the interfaces below with the completed multi-board implementation before editing code.

This plan covers private sharing, account-specific layouts, and auto-layout. Public links, email delivery, collaborative editing of source cards, responsive card sizing, ownership transfer, and undo are outside this version.

Appearance settings follow sharing and auto-layout as a separate phase. Their required capabilities and remaining choices are recorded below.

## Access and sharing controls

Only the author grants or revokes access. Enforce that rule in the server, not just by hiding controls. A shared board URL is an address, not a credential. Forwarding it never grants access.

Use one fixed viewer permission. Viewers read the author’s live content and customize their own card geometry. They cannot edit source content, remove or transfer source cards, rename or delete the board, invite people, inspect its access list, or access the author’s bot connection. A viewer’s personal layout never becomes a separately owned copy of the source board.

| Action | Author | Invited viewer |
| --- | --- | --- |
| View live cards and use slideshow | Yes | Yes |
| Move, resize, or auto-layout cards | Changes the default layout | Changes their personal layout |
| Reset personal layout | Not applicable | Yes |
| Grant, list, or revoke access | Yes | No |
| Rename/delete board or remove/transfer cards | Existing owner rules | No |
| Retrieve or use the author’s bot credentials | Existing owner rules | No |

Add **Sharing** to the author’s board-tab dropdown. Open a dialog with an email input, an **Add access** action, an access list, **Remove access** actions, and **Copy board link**. Show invited email addresses, available account names, and pending or active status. Treat the author’s access as implicit and non-removable. The author sends the copied URL manually. Adding an existing invitation is idempotent. Adding the author as a viewer reports that they already own the board.

Support invitations before registration. Trim and lowercase email addresses, but do not collapse dots, plus aliases, or different addresses. Match invitations to a verified Google email and bind accepted access to the stable user ID. Do not trust an email supplied by the browser or assume that a signed-in session proves email verification. Persist verified identity from Google’s OAuth profile and require reauthentication when an existing session lacks that proof. Google exposes `email_verified` through the [NextAuth Google provider](https://next-auth.js.org/providers/google). Once bound, authorize by user ID rather than allowing another account to inherit access by presenting the old email.

Preserve the board URL through sign-in. Accept only validated internal board return paths. An uninvited account cannot load cards. Shared card responses use private, no-store caching, and every read and write checks current access. Do not cache board grants in a long-lived session token.

Revocation takes effect on subsequent server requests. On the next refresh, remove the shared tab and displayed content. Stop playback if the revoked board is displayed and return to the viewer’s original board with an access-removed message. Writes recheck access within their transaction so a queued layout save cannot bypass revocation.

Revocation preserves the viewer’s saved geometry while the board and cards exist. Re-inviting the same account restores it. Deleting the board or a card removes its associated overrides. These controls cannot prevent an authorized viewer from copying or screenshotting visible information.

## Shared-board navigation and personal layouts

Keep owned boards in their existing order. Append shared boards in grant order, with the grant ID as a stable tie-breaker. Give shared tabs a subtle violet tint, a shared badge, and the author’s display identity. Preserve active and keyboard-focus states. Color is not the only indication of sharing, and duplicate board names across authors remain distinguishable.

The same permanent board URL serves the author and invited viewers. Render its layout for the authenticated user without accepting a client-supplied viewer ID. Shared boards participate in the existing slideshow with that viewer’s effective layout. Pending email grants appear in the viewer’s toolbar once a verified account is bound to them.

Keep author geometry on the existing source cards. Store viewer overrides separately, uniquely identified by viewer, board, and card. Each override contains the complete `x`, `y`, `width`, and `height` geometry. A card inherits author geometry until the viewer customizes it. The first customization snapshots its effective geometry into an override.

Persist overrides in the database so they follow the account across browsers and devices. Once a card has an override, subsequent author geometry changes do not replace it. Content updates still come directly from the source card. No viewer-specific copies of bot documents, content revisions, or credentials are created.

While idle, polling applies the server’s effective geometry as well as bot content. The current content-only polling merge must change so uncustomized cards follow author layout updates. Retain gesture, mutation-queue, and request-epoch guards so stale reads cannot overwrite local work.

Use **Edit layout** for owned boards and **Customize my layout** for shared boards. Shared-board customization exposes movement, resizing, **Auto-layout**, and **Reset to author’s layout**. Hide source-card removal, board-transfer dropdowns, bot connection controls, and sharing management. The server rejects those operations even if requested directly.

**Reset to author’s layout** deletes all of the current viewer’s overrides for that board and returns the current author geometry. Other viewers remain unchanged.

New author cards start at the author’s placement. Do not automatically rearrange existing viewer overrides. When the author deletes or transfers a card, remove its source-board overrides in the same transaction. If the viewer also has access to the destination, the transferred card starts there at the author’s destination placement. Source content and stable bot keys retain the multi-board implementation’s identity and update rules.

## Data and API contract

Add a board grant with board ID, normalized invited email, nullable accepted user ID, and creation time. Enforce one grant per board/email and one active grant per board/user. Derive pending status from the unbound grant rather than maintaining separate status flags. Add viewer geometry overrides with cascading cleanup for deleted users, boards, and cards. Validate card membership before reading or writing overrides.

Centralize board access resolution. Return an authenticated author or invited viewer capability, then use that capability throughout board pages, card reads, layout writes, and playback. Keep bot authentication and owner-scoped bot capabilities separate from browser viewer access.

Reuse the completed multi-board card read and geometry-write routes. Extend reads with effective geometry, a per-card `layoutSource` of `author` or `personal`, a board `layoutToken`, and an access role of `author` or `viewer`. The token hashes the ordered card IDs, effective geometry, and override presence. Exclude content, title, revision, and invitation metadata. Bot content updates therefore do not invalidate a layout snapshot.

For individual geometry writes, owners update canonical card geometry and viewers update only their own overrides. Preserve existing validation limits and origin/JSON guards. Reject viewer writes to content or ownership fields.

Add these browser-session endpoints, adapting route names only if the multi-board implementation already provides an equivalent:

| Endpoint | Behavior |
| --- | --- |
| `GET /api/boards/[boardId]/shares` | Author-only access list. |
| `POST /api/boards/[boardId]/shares` | Author-only grant using `{email}`. Repeated grants return the existing grant. |
| `DELETE /api/boards/[boardId]/shares/[shareId]` | Author-only revoke, scoped to the route’s board. Repeated removal is harmless. |
| `DELETE /api/boards/[boardId]/layout` | Invited viewer resets their own overrides and receives updated cards and layout token. |
| `PUT /api/boards/[boardId]/layout` | Atomic auto-layout save using `{expectedLayoutToken, positions: [{cardId, x, y}]}`. |

Never accept a requested viewer ID for these layout operations. The reset endpoint cannot delete author geometry. Sharing-management endpoints require the author’s browser session and do not accept bot Bearer tokens. Bot board discovery lists the bot owner’s boards, not boards merely shared with that owner.

## Auto-layout algorithm and saving

Show **Auto-layout** only while editing or customizing the current board. Disable it for empty boards, slideshow mode, gestures, and queued writes. Track busy and gesture states reactively so disabling happens immediately.

Use a pure `arrange(cards, viewportWidth)` function. Snapshot current effective geometry and sort by `y`, then `x`, then a stable lexical card ID. Measure the visible canvas container’s `clientWidth`, not its minimum-width scrolling canvas. Reject a nonpositive viewport width.

Start at `x = 20`, `y = 20` with a zero row height. For each card, start a new row if the current row is nonempty and the card does not fit before the right-hand 20px padding, or its origin would exceed the permitted x coordinate. Advance y past the previous row’s tallest card plus at least 20px, rounded upward to the 20px grid. Reset x to 20. Place the card, update the row height, then advance x past its width plus at least 20px, rounded upward to the grid.

Keep widths and heights exactly unchanged. A card wider than the viewport occupies its own row and remains horizontally scrollable. Validate every proposed origin against the existing 0–10,000 coordinate bounds. Never clamp invalid positions into overlapping cards. If the arrangement cannot fit those bounds, retain the entire current layout and show a capacity message. Apply only on an explicit click, not on resize, reload, or a bot update.

Save the positions in one transaction. Recheck access, the exact current card set, duplicate IDs, position validity, and the layout token before writing. Reject a stale card set or geometry with 409 and no partial writes. A viewer batch preserves effective dimensions and creates complete geometry overrides. An author batch changes canonical positions only. Return authoritative effective cards and the new layout token.

Serialize the batch with manual geometry writes, resets, and transfers. Invalidate old polling responses during a save. On success, update local geometry from the server. On conflict, reload the authoritative layout and require another explicit click. A storage failure leaves the saved layout unchanged and shows an error. No bot or AI service participates.

## Follow-up phase: appearance settings

Start this phase after sharing and auto-layout are complete and verified.

- Let users choose a background image or a solid background color.
- Let users choose an accent color for interface controls and active states.
- Provide a live preview, explicit save, and reset to the default appearance.
- Persist saved appearance across reloads and devices. Apply the selected appearance during slideshow playback as well as normal viewing.
- Each board starts with the author’s default appearance. Invited viewers can save personal background and accent overrides for that board against their account. Their choices do not change the author’s defaults or another viewer’s appearance.
- Inherit the author’s appearance until a viewer saves an override. Resetting a viewer’s appearance clears their overrides and restores the author’s current defaults. Resetting appearance does not reset card layout.
- Keep text, focus indicators, and controls readable against the selected background and accent. Preserve semantic status colors and the shared-board badge.
- Replace the current hardcoded dashboard background and blue control colors with scoped appearance values. Keep appearance preferences separate from bot content and layout geometry.

Appearance is per board, with author defaults and private viewer overrides. Background images are uploaded to the existing application server. Store uploads on persistent server storage outside the application build and include them in backups. Store asset references in the database rather than embedding image bytes in appearance preferences. An author selects the board's default image. A viewer's uploaded image remains a personal override.

Cloudflare in front of the server provides CDN delivery and caching where access rules permit. Give each uploaded image a new immutable asset identifier so replacing an image does not reuse a stale cache entry. Keep uploads separate from the static public directory. Validate image formats and sizes at upload.

Image access follows the board's existing permissions, including revocation. Personal viewer images are accessible only to that viewer. A cache hit must not bypass access checks. Private image responses bypass shared caching until authenticated delivery can check permission before serving a cached image. Cloudflare's [default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) excludes responses marked `private` or `no-store`. Confirm the authenticated CDN delivery and cache rules during implementation. No Cloudflare configuration changes are included in this planning update.

## Implementation order

1. Integrate the completed multi-board work. Confirm stable board IDs, owner checks, scoped card reads/writes, transfer cleanup, and the shared slideshow shell. Read relevant bundled Next.js guides before editing code.
2. Add grants, verified-account binding, override storage, and centralized access checks. Verify unauthorized access and cross-account isolation before exposing shared boards in the UI.
3. Add the Sharing dialog, shared tab appearance, effective layout reads, personal move/resize writes, and reset. Verify two invited accounts have independent layouts and that authors alone manage access.
4. Add the pure auto-layout function, layout token, and atomic batch endpoint. Connect the button for author and viewer editing modes.
5. Integrate shared boards with slideshow and revocation handling. Run the full verification below and update user-facing documentation.

## Verification and acceptance

Use temporary SQLite databases and isolated servers. Verify behavior through actual HTTP requests and rendered browser sessions rather than checking only implementation helpers.

- Share with an existing verified account and with an email whose account registers later. Reject unverified identity, the wrong account, forged cookies, invalid origins, and uninvited forwarded URLs. Verify deep links survive sign-in. A signed local test session alone does not verify the Google OAuth callback.
- Verify only the author can list, add, or remove grants. Test duplicate grants, removal retries, cross-board share IDs, direct viewer management requests, and bot-token requests to sharing endpoints.
- Use an author and two viewers. Move and resize the same card differently, reload, and open another browser session. Verify viewer arrangements persist independently and never modify author geometry.
- Verify uncustomized cards follow author layout changes, overridden cards retain geometry, bot content updates reach all viewers, and reset restores current author geometry.
- Verify source-card deletion and transfer remove source overrides. Check destination access and initial placement. Revoke access during reads, queued saves, and slideshow playback. Verify re-invitation restores surviving overrides.
- Check shared tab tint, shared badge, author identity, active/focus states, author-only Sharing controls, access-list status, layout labels, and mobile toolbar behavior.
- Test auto-layout with fixed expected placements for narrow and wide screens, mixed heights, odd pixel sizes, oversized cards, empty and single-card boards, repeated clicks, and coordinate-limit failure. Assert no overlaps, unchanged dimensions, preserved content, and stable order.
- Verify batch saves are atomic. Exercise concurrent card creation/removal, manual geometry changes, content-only bot updates, revoked access, and storage failure. Confirm failures never leave a partially rearranged board.
- Inspect actual desktop and mobile rendering, shared-board slideshow fitting, and controls after access removal. Run lint, typecheck, build, smoke, bot-contract, bot-smoke, and deterministic browser checks from repository documentation.

Completion means authorized viewers can open the same live board URL, maintain independent saved layouts, and use deterministic auto-layout. Only the author can change access or source cards. Report the actual OAuth, browser, and database verification boundaries. Do not publish, deploy, or change external systems as part of this plan without separate authorization.
