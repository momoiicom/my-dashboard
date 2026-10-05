# Board appearance implementation contract

The selected board and each slideshow panel resolve the author's defaults with the current viewer's private preferences. Appearance stays separate from card geometry, layout tokens and bot content.

## Data and user flow

Use a discriminated background with built-in image, solid color, or uploaded asset variants. Accent colors are normalized six-digit hex colors. Viewer background and accent preferences independently inherit the author value. Reset previews built-in defaults for authors or inheritance for viewers. Save commits the reset. Cancel discards the preview.

The appearance response carries effective values, author defaults, personal choices, source labels and a token independent of the layout token. Author and viewer revisions prevent stale saves and reset/save cycles from accepting an old token. Board snapshots include this response so polling and slideshow use the same resolution.

Image selection previews a browser object URL. One bounded multipart Save persists image and preferences together. There is no upload-first endpoint or persisted draft. The server decodes JPEG, PNG and WebP, rejects invalid/animated/oversized inputs, strips metadata and normalizes a bounded raster through sharp. Files use fresh random identifiers under persistent server storage outside public and the build. The database records metadata and references. Failed writes remove the new file. Document safe unreferenced-file maintenance and database-plus-file backups.

`lib/prepare-wallpaper.ts` checks file signatures, dimensions and animation markers before browser decoding. Source limits are 50 MiB, 50 million pixels and 16,384 pixels per edge. Native decoding applies EXIF orientation. Canvas produces WebP at quality 82 within 4,096 pixels per edge, without enlargement. An output above 10 MiB triggers bounded retries at smaller dimensions. Browsers without WebP encoding show an error. The server still validates and normalizes every upload independently.

The editor replaces its file and object URL only after preparation succeeds. Save stays disabled during preparation. Failed replacements preserve the last valid preview. A separate selection generation and AbortController invalidate pending preparation on replacement, Reset, background changes, reload, Cancel and unmount. Native decoding cannot abort mid-operation; a queue serializes file reads, decoding and encoding, then releases bitmap and canvas resources. This prevents rapid replacements from retaining several large decoded images or input buffers. Selection and preview make no HTTP writes.

Every mutation rechecks current board access inside its transaction. Authors update defaults, viewers only their own preferences. A viewer cannot attach another viewer's asset or copy an author asset into personal ownership. Author images are inherited through the author background choice.

Image reads recheck current board access and asset scope before opening files. Viewers read the currently referenced author image and their own images only. Responses use private/no-store, Vary Cookie and nosniff headers. No external Cloudflare configuration changes are included. Permission checks must precede shared CDN cache hits to preserve revocation.

## Rendering and requests

Enable account menu Settings for the selected board. Show a responsive appearance dialog with live board preview, background controls, image selection, accent color, viewer inheritance controls, Save, Reset and Cancel. Keep Close and Escape available during stalled requests. Aborting a request does not undo a server commit. Ignore late editor responses and reconcile saved state through fresh reads.

Keep saved baseline and draft separate. Polls refresh the baseline without replacing explicit draft choices. Untouched inherited fields can follow current author defaults. The captured appearance token protects the submitted draft from remote edits. A mutation epoch rejects polls started before a save. Responses must match board and request generation. Access removal closes the editor and clears preview.

Scope appearance variables to the normal board and each slideshow panel, including both panels during a transition. Playback uses saved appearance. Preserve login styling and shared violet indicators. Derive black or white foregrounds by contrast, and adapt muted text, hover backgrounds, status tones, and focus indicators to the selected backgrounds. Portaled UI receives the same tokens explicitly.

## Synthesis decision

Three designs were compared on permissions, inheritance/reset, upload lifecycle, preview consistency, panel styling and interface size. The Astra design is the base. The independent cross-judge scored it 29/30 and also chose it. Atomic Save avoids staged-upload ownership, expiry and cancellation cleanup. Grafts add source labels, database discriminant constraints, private asset response headers and live inheritance beneath explicit draft choices. Separate upload-first and immediate-reset endpoints are unnecessary.

Model the Domain shaped the background union and editor lifecycle. Separate Before Serializing Shared State shaped actor-specific preferences and the isolated implementation worktree. Prove It Works requires real HTTP access checks and desktop/mobile rendered verification.

## Verification

Use temporary databases, upload directories, author and two viewer sessions. Exercise inheritance, independent fields, reset after author changes, persistence, invalid uploads, stale/failed writes, cross-board/cross-viewer image denial, revocation and unchanged geometry/content. Inspect settings, actual preview, saved board and slideshow on desktop and mobile. Run build, lint, typecheck and board/sharing regressions. Production storage backups and live Cloudflare behavior remain deployment verification boundaries.

## Implementation reconciliation

The implementation keeps the editor lifecycle in `components/appearance-dialog.tsx` and shares the CSS variable calculation through `components/appearance-surface.tsx`. A separate editor hook and wrapper component would add another owner for the same draft without reducing state. The built-in image remains a bundled CSS asset in `app/globals.css`; it is not copied into `public`.

The asset foreign keys use `ON DELETE NO ACTION` with strict background shape checks. This lets a board deletion cascade through its viewer rows and assets without an intermediate `image` row whose asset reference has been set to null. A migration test deleted a board with both author and personal image references, then checked foreign-key integrity.

Next's proxy buffers request bodies before route handlers and truncates them at its default 10 MB limit. `proxyClientMaxBodySize` is set to 11 MiB so a valid 10 MiB file plus form fields reaches the route. The route counts the incoming stream independently and rejects requests above 10 MiB plus 64 KiB, including chunked requests. The image decoder still enforces the separate 10 MiB file limit.

`scripts/appearance-cleanup.ts` removes database assets without references and untracked files after a 24-hour grace period. It checks references again before row deletion and keeps the files for assets still present in the database. See [appearance verification](appearance-verification.md) for the HTTP and rendered checks.

## Apply to all boards

The unchecked checkbox keeps the existing single-board Save behavior. Selecting it captures the current accessible board IDs and appearance tokens with `GET /api/boards/<boardId>/appearance?all=true`. PUT accepts that captured target set in its multipart preferences. The server checks the entire accessible set, the selected board role, and every revision before processing an image and again inside the write transaction. A changed set, revoked invitation, or stale appearance rejects the batch without partial database writes.

Owned boards receive author defaults; shared boards receive private preferences for the caller. Null inherited viewer fields preserve owned defaults and clear private overrides on shared boards. Shared author images cannot be copied through inherited fields or forged asset references. Uploaded images are normalized once; existing images must belong to the caller in the selected board. Each destination receives a separately scoped asset and immutable file. Failed batches remove all staged files. No schema migration or Cloudflare change is required. The request supports up to 200 boards, and bulk metadata is bounded to 64 KiB.

## Automatic and Advanced colors

`lib/appearance-palette.ts` derives two dark toolbar tones and a subtle card tint from the effective accent. Filled buttons use the accent. A sparse `colors` map can replace any of these backgrounds through the collapsed Advanced editor. Its four keys are `mainToolbar`, `boardToolbar`, `card`, and `button`.

Author choices contain normalized hex colors. A missing key uses automatic colors. Viewer choices add an explicit `auto` value that bypasses an author's manual background. A missing viewer key inherits the author's choice. Effective maps contain only resolved hex overrides.

The additive `20261005100000_advanced_appearance` migration adds four nullable columns to Board and ViewerAppearance. Database checks reject invalid colors and allow `auto` only for viewers. Existing appearance revisions also protect these fields. A legacy Save without the whole colors field preserves saved Advanced choices. A present map replaces choices, and an empty map resets author colors to automatic or viewer colors to inheritance.

Apply to all copies custom colors. Author automatic choices become explicit automatic choices on shared boards. Inherited viewer choices preserve each owned board's existing defaults. Explicit viewer automatic choices clear the corresponding owned-board override. The existing transaction commits these changes together.

The editor preserves raw hex input separately from its last valid preview. Invalid custom input disables Save even when Advanced is collapsed. Reset, Reload, Cancel, and Reapply follow the existing appearance lifecycle. Preview, normal boards, and slideshow cards share the same palette function. Foreground and secondary text meet 4.5:1 contrast against their backgrounds; focus indicators use contrasting outlines.
