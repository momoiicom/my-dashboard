# Private sharing and auto-layout verification

Implementation base is `main` at `90a1032`. The change reuses multi-board IDs, URLs, source-card membership revisions, transfers, bot contracts, and the slideshow controller.

## Implemented behavior

- Authors add normalized email grants, list pending/active access, revoke grants idempotently, and copy the permanent board URL. Existing verified accounts bind immediately; pending grants bind after verified Google sign-in. Accepted grants authorize by stable user ID.
- A Google OAuth-profile callback persists verified email separately from the generic adapter email. Sharing also requires a session proof created by that callback. Legacy invited sessions receive a reauthentication link with a validated board return path. Session email cannot grant access.
- Every browser board read resolves current author/viewer access. Source mutations remain owner-only. Bot discovery includes owned boards only. Card responses are private and no-store.
- Viewer geometry is a separate complete override. Idle polling uses effective geometry and live source content. Reset affects only the current viewer. Transfer removes source overrides inside its transaction; user/board/card deletion cascades through overrides. Revocation retains surviving geometry for re-invitation.
- Shared tabs have a violet tint, visible Shared badge, author identity, and existing keyboard focus/selection behavior. Viewer controls expose movement, resizing, auto-layout, and reset. Source removal, transfer, bot connection, and sharing controls are absent.
- Auto-layout is pure and deterministic. It measures the visible scroll container, keeps dimensions, places oversized cards in their own row, and rejects capacity failures before writing. Batch saves check access, exact card membership, origins, and a hash of geometry plus override presence in one transaction. Content updates do not change that hash.
- Polling, manual writes, resets, transfers, and batches retain mutation/gesture/epoch guards. Conflicts reload authoritative geometry and require another click. Shared-board access removal clears normal viewing and stops playback before returning to the original board.

## Verification evidence

All checks use local artifacts and temporary SQLite databases; no deployed database or external account was changed. Final sharing acceptance ran on Node.js 22.23.3 with a matching rebuilt native SQLite dependency.

| Check | Observed result |
| --- | --- |
| `npm run lint` | Passed; pre-existing bot-card image warning remains. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed for integrated code and sharing routes. |
| `npm run test:boards:migration` | Passed legacy preservation through both board and sharing migrations, ownership constraints, absent legacy verification proof, and empty grants/overrides. |
| `npm run test:smoke` | Passed signed-session rendering, forged-cookie rejection, card CRUD, origins and isolation. |
| `npm run test:boards:api` | Passed board, membership, transfer, capacity and bot-targeting contracts. |
| `tsx scripts/bot-contract.ts` / `tsx scripts/bot-smoke.ts` | Passed document contracts, browser/Bearer isolation, token recovery, revision/content and storage checks. |
| `npm run test:arrange` | Passed fixed wide/narrow/odd-size/mixed-height/oversized placements, lexical tie order, repeated application and capacity rejection. |
| `npm run test:sharing:auth` | Passed verified/unverified/missing-profile proof persistence and session projection with synthetic Google profiles. |
| `npm run test:sharing:api` | Passed private access, origins, pending binding, stable-user grants, legacy-session reauthentication/deep links, concurrent duplicate invitations, author-only management, independent geometry, reset, token conflicts, content-only updates, revocation/re-invitation, transfers/deletions, and second-write failure rollback. |
| `npm run test:e2e:sharing` | Passed author/two-viewer desktop/mobile sessions, Sharing dialog, persisted keyboard movement/resizing, another browser context, mobile auto-layout/reset, preserved dimensions, personal isolation, slideshow fitting, playback revocation, queued-save revocation, a late rejected write after navigation, and a late revoked-board poll after slideshow advancement. |
| `npm run test:e2e:boards` / `npm run test:e2e` | Passed board/slideshow accessibility and behavior regressions, plus both deterministic dashboard trials. |

A SQLite trigger aborts the second viewer override insert to prove transaction rollback rather than merely rejecting a request before writes start. Browser tests block a geometry request, queue another, revoke its grant, then release the requests and verify restored geometry after re-invitation. Delayed-response browser tests navigate away before releasing a rejected write and advance the slideshow before releasing a former board’s 404. Both verify the authorized current board remains displayed. Stable-ID tests change the accepted user's email and create another verified account presenting the old address; the accepted user retains access and the new account does not inherit it.

## Runtime finding and resolution

The expanded sharing browser suite reproduced a native server abort on Node.js 24.21.0 and the bundled 24.19.0 runtime. The fatal error was `node::RemoveEnvironmentCleanupHook` asserting `(env) != nullptr`, called from the `better-sqlite3` native `Statement` destructor during garbage collection. The browser then reported connection refused. This was independent of the application’s delayed-response assertions.

The local driver is `better-sqlite3` 12.11.1. The [Node.js 24 ObjectWrap implementation](https://github.com/nodejs/node/blob/v24.21.0/src/node_object_wrap.h) calls a cleanup hook in its destructor. The downloaded Node.js 22.23.3 headers omit that call. This supports the runtime compatibility diagnosis; it does not establish an upstream fix.

Node.js 22.23.3 was downloaded to a temporary directory from nodejs.org and checked against its published SHA-256. The native dependency was rebuilt for that runtime. The complete sharing suite then passed with the server still running. `.nvmrc` and package engines now select Node.js 22. Install dependencies again after changing runtimes. Node.js 24 remains unsupported for this version; the driver itself was not patched.

The first Node.js 22 browser run passed the two delayed-response assertions but failed its cleanup click because slideshow controls had auto-hidden. The test now reveals controls with pointer activity before clicking Stop, matching existing board tests. The complete rerun passed.

## Rendered evidence

- [Desktop viewer](images/sharing-desktop.png)
- [Mobile customization](images/sharing-mobile.png)
- [Author Sharing dialog](images/sharing-dialog.png)
- [Mobile shared-board slideshow](images/sharing-mobile-slideshow.png)

Screenshots were opened and inspected. Shared-tab badge/identity truncation and dialog text contrast were corrected based on rendered output, then browser verification was repeated.

## Remaining boundaries

The Google callback fixture calls the actual NextAuth JWT callback with supplied OAuth profiles, and HTTP/browser sessions are locally signed. No real Google OAuth authorization redirect, code exchange, or production callback was exercised. A configured Google client and an actual invited Google account are still required for that external acceptance check. The [NextAuth Google provider’s documented `email_verified` field](https://next-auth.js.org/providers/google) and the installed NextAuth callback flow were inspected.

Appearance settings remain the separate follow-up phase in the plan. Background-image supply and storage must be settled before that phase. The user subsequently authorized a pull request and CI/review follow-up. Merge, deployment, and changes to external application systems remain outside this work.

Read-only review by `gpt-6-astra` found two delayed-request identity races, both fixed and verified by browser regressions. The final source and audit review found no additional correctness issue. Review attention remains on the real OAuth boundary, Node.js 22 requirement, and deferred appearance phase.
