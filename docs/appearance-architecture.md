# Board appearance implementation contract

The selected board and each slideshow panel resolve the author's defaults with the current viewer's private preferences. Appearance stays separate from card geometry, layout tokens and bot content.

## Data and user flow

Use a discriminated background with built-in image, solid color, or uploaded asset variants. Accent colors are normalized six-digit hex colors. Viewer background and accent preferences independently inherit the author value. Reset previews built-in defaults for authors or inheritance for viewers. Save commits the reset. Cancel discards the preview.

The appearance response carries effective values, author defaults, personal choices, source labels and a token independent of the layout token. Author and viewer revisions prevent stale saves and reset/save cycles from accepting an old token. Board snapshots include this response so polling and slideshow use the same resolution.

Image selection previews a browser object URL. One bounded multipart Save persists image and preferences together. There is no upload-first endpoint or persisted draft. The server decodes JPEG, PNG and WebP, rejects invalid/animated/oversized inputs, strips metadata and normalizes a bounded raster through sharp. Files use fresh random identifiers under persistent server storage outside public and the build. The database records metadata and references. Failed writes remove the new file. Document safe unreferenced-file maintenance and database-plus-file backups.

Every mutation rechecks current board access inside its transaction. Authors update defaults, viewers only their own preferences. A viewer cannot attach another viewer's asset or copy an author asset into personal ownership. Author images are inherited through the author background choice.

Image reads recheck current board access and asset scope before opening files. Viewers read the currently referenced author image and their own images only. Responses use private/no-store, Vary Cookie and nosniff headers. No external Cloudflare configuration changes are included. Permission checks must precede shared CDN cache hits to preserve revocation.

## Rendering and requests

Enable account menu Settings for the selected board. Show a responsive appearance dialog with live board preview, background controls, image selection, accent color, viewer inheritance controls, Save, Reset and Cancel. Keep Close and Escape available during stalled requests. Aborting a request does not undo a server commit. Ignore late editor responses and reconcile saved state through fresh reads.

Keep saved baseline and draft separate. Polls refresh the baseline without replacing explicit draft choices. Untouched inherited fields can follow current author defaults. The captured appearance token protects the submitted draft from remote edits. A mutation epoch rejects polls started before a save. Responses must match board and request generation. Access removal closes the editor and clears preview.

Scope background and accent variables to the normal board and each slideshow panel, including both panels during a transition. Playback uses saved appearance. Preserve login styling, shared violet indicators and status colors. Derive black or white accent foreground by contrast and keep neutral control/card surfaces plus visible focus indicators. Portaled UI receives the same tokens explicitly.

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
