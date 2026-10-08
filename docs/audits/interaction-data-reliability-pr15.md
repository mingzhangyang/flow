# PR #15 — Interaction & Data Reliability audit

Constitution: C0, C5, C6, C9, C10, E3, E4, E6, AI-C1

## C9 — Boundaries and invariants

- **UI** owns presentation, a visible pending/failed check-in intent, retry and exit warning. It never owns an authoritative check-in table for writes, and may consume an async result only while its route/operation is current.
- **Application/session** owns accepted operation ordering and definition-scoped lifetime. Closing a session prevents new commands but drains accepted writes. An import already committed continues even when its screen disappears. The app shell revokes stale navigation synchronously.
- **Storage** owns authoritative read/modify/write of check-in records in one per-definition lane shared by the runtime session, backup merge, loads, and deletion. The write resolves only on a successful KV commit. A durable undo identity is co-written with the visible log and honored by imports.
- **Clock** owns calendar projection and event boundaries with explicit `now` and `TimeZone` inputs. UI only schedules necessary refreshes and foreground/wall-clock/zone-change checks. The recurrence algorithm is unchanged.

## Confirmed defects on PR #14 main

| Location | Failure before | Boundary correction |
| --- | --- | --- |
| ScheduleScreen / RuntimeSession / Storage | `setCheckIns` ahead of a rejected `saveCheckIns(next)`, with swallowed rejection; a stale whole-table snapshot could overwrite another change | Confirmed-write state, retryable immutable dose intent and authoritative failure reload; `changeCheckIn` serializes per-key read/modify/write; bulk session save removed |
| GenerateScreen | Late network success after Back invoked `onDraft` and could reopen Editor; an unhandled settings-save error was hidden | Shared `OperationScope`, route identity check in App, and explicit secure-store error |
| ImportScreen / backup restore | Multiple submits could issue multiple commits; post-exit success could navigate; restore and live check-in could read/write in different queues | Synchronous one-at-a-time submission, route identity checks; completion isn't confused with cancellation; atomic storage-lane merge |
| HomeScreen | `now = Date.now()` was not a memo dependency, so next event/date could stay stale | Explicit time projection, next event/horizon/midnight deadlines, foreground refresh and 60s non-rendering jump/zone watchdog |
| ScheduleScreen off-day date | `getMonth/getDate` came from device timezone while next-event time came from Flow timezone | Pure `calendarDateAt(instant, tz)`, same zone for date/time |
| Insight restore / Home backup/delete | Important failed storage operations could be silently ignored or an old completion could update UI after exit | Visible errors/retry, shared operation scope and guarded navigation |

## Existing protections retained — no duplicate machinery

- `createDefinitionRuntime` already fences sessions, drains accepted tasks in FIFO, and waits before durable deletion; these behaviors stay intact and contract-tested.
- `runCommittedCatalogMutation` distinguishes committed storage mutation from downstream catalog/notification refresh errors; it remains authoritative for import/restore.
- `createCatalogCoordinator` serializes catalog work and suppresses stale projections; no replacement or new dependency is introduced.
- Runtime recurrence, missed-dose rules, notification schedules, Flow/Node/Run schemas, and serializer remain unchanged.

## Risks distinguished, not silently generalized

- **Within this PR:** check-in/undo and backup interleaving, import/generate/Insight stale completion, Home clock and anchored calendar fields, user-visible Home storage errors.
- **Already protected:** definition deletion drain, catalog snapshot ownership, committed import vs later refresh failure, existing Android Editor dirty-state contract.
- **Theoretical/environmental:** an OS force-kill before a KV write completes cannot guarantee durability; confirmed-write UI therefore never claims such an intent committed. Per-definition serialization is scoped to the application's one Storage instance, not cross-process CAS.
- **Out of scope:** `usePersistentRun.ts` still optimistically saves sequential Run snapshots with `.catch(() => {})`; this requires its own Run-event persistence contract and should be prioritized in a follow-up. Notification permission status read failures have a separate, existing notification capability boundary.

## Verification targets

- Contract tests: committed check-in, failed record/undo, retry, duplicate/rapid writes, stale failure, close/drain, load/reopen, backup excludes pending, backup/live merge.
- Operation tests: mock Generate success/error/Back, import double-click/exit/commit/failure/retry, latest-result ordering.
- Clock tests: initial/upcoming boundary, priority and catalog changes, midnight, horizon entry, zone changes, time jumps, IANA anchored date, DST spring/fall.
- Web E2E: check-in write failure and retry + reload, mock-network Generate then Back, live Home fake-clock updates, import double-click; existing E2E suites stay enabled.
- Device follow-up: Android Back/exit warning while a storage write is pending, background/foreground during I/O, Keychain/Keystore transient failure, timezone changes with native AppState, and Android/iOS reminder behavior.

No auto-merge. Workstreams A–D are implemented as one scoped PR.

## Copilot review closure (round 1)

The four medium-severity review findings were checked against the real execution paths and fixed at their owning boundaries:

1. **Android Back on run-to-run notification replacement:** the native Back listener now dereferences the current route and its topology at invocation time, and Schedule's exit handler is session-id keyed. No old run closure can bypass a pending check-in warning.
2. **AI model credential load/submit race:** `OperationScope.invalidateLatest()` revokes pending UI load projections immediately upon editing any configuration field. An application-owned `ModelConfigSession` also serializes SecureStore reads/legacy migrations and accepted saves, so stale migration cannot durably overwrite the user's new settings, even after screen exit.
3. **Backup sharing after Home exit:** read-only backup export may finish, but the share sheet and clipboard side effects are authorized only while the original Home scope and App route remain active.
4. **Deletion navigation during runtime retirement:** App owns a synchronous deletion fence from accepted mutation until completion, and Home disables every route-changing control; notification routes and Android navigation follow the same fence. Deletion failure is surfaced and retryable on the original Home screen.

Regression tests use deferred promises and route-driven Back decisions. No schema, recurrence, reminder or visual behavior changed.

## Watchdog lifetime closure (previously missed)

**Confirmed:** The original Home timer was one-shot. After a wall-clock/zone
correction, its callback called `setNow(actual)` but did not re-arm. If the
recomputed `nextRefreshAt` stayed equal to the previous value, the effect's
`[projection.nextRefreshAt]` dependency did not change, leaving Home without
any future timer.

**Ownership fix:** `createHomeClockWatch` in the UI adapter layer now owns a
single continuously re-armed watchdog. It samples a supplied clock and zone
without updating React at every heartbeat, while `projectHomeTime` retains the
one authoritative deadline. React updates the deadline explicitly and disposes
the watch on unmount. Expired deadlines use a bounded heartbeat rather than
busy-spinning while a projection catches up.

**Verification:** Deterministic fake timers simulate backward system time,
an unchanged anchored deadline, later event expiry, zone changes, foreground
resume, deadline rescheduling, cleanup, and Strict Mode stop/start. An E2E
fake-clock regression asserts the Home Up Next transition after a backward
clock correction without remounting the page. No recurrence/DST rule changes.

## High-severity review: backup restore resurrected a newer local undo

**Confirmed root cause:** The original in-lane `mergeCheckIns(local, incoming)` knew
only present records; removing a dose left no ordering fact. A subsequent
backup import treated that dose as never recorded and restored a stale
confirmation. Serialization protected concurrent writes but did not capture
the meaning of a successful local undo.

**Contract at the storage boundary:** `src/storage/checkInState.ts` stores
visible `CheckIn[]` and explicit undo identities in one durable KV value
per canonical definition key. `Storage.changeCheckIn` commits an immutable
`record` or `undo` intent; `Storage.mergeBackupCheckIns` respects both
confirmed records and undone identities. Both use the existing per-key FIFO
read/modify/write lane and ACK only after a single write of log + undo
metadata. New local `record` cancels the old undo identity; local bulk
replacement cannot bypass the protection. Definition deletion erases both.

**First-public-v1 representation:** The KV namespace `checkins:v1:` accepts
one internal envelope shape, `{ v: 1, log: CheckIn[], undone: CheckInIdentity[] }`.
Pre-release raw arrays are rejected without mutation (no migration, fallback
or second supported on-disk shape), consistent with the unreleased app's
single-format contract. Malformed envelopes fail closed. The distinct public
Backup v1 shape is unchanged and still exports *only confirmed present
entries* — no internal undo identities or schema additions. Tombstones are
strictly local: importing an old backup on a completely fresh device with no
local undo history can restore it, consistent with Backup v1's existing
behavior.

**Verification:** Same-dose undo followed by restore (including accepted
undo, session close, and delayed storage write); restart and repeated restore;
undo of an already absent dose; newer re-check-in after undo; failed undo
does not leave a phantom tombstone; full-log replacement; corrupt metadata
read/write refusal; same-name/different-day dose isolation; definition
deletion clearing undo identities; Backup v1 excludes local undo metadata. A browser E2E also covers check-in → undo → import an old same-dose backup → reopen and reload Schedule.

## High-severity review: foreground notification bypassed an unsaved check-in

**Root cause:** App's notification `openRun` previously closed the active
RuntimeSession and constructed a replacement Run without consulting the active
Schedule screen's exit handler. Only Header Back / Android Back used its
confirmation. A still-pending write could later fail after the retry-capable
screen had disappeared. The same external route path could bypass an Editor's
dirty-discard confirmation.

**Architecture correction:** `src/ui/leaveGuard.ts` defines a small
screen-owned, Promise-based leave decision. Schedule grants immediate passage
only with no outstanding dose intent; otherwise its existing translated
warning offers Cancel / Leave anyway. Editor uses the same boundary, preserving
dirty-discard and blocking navigation while saving. Both register scoped
permission functions during layout. App alone performs navigation, verifies
the originating route is still active after any async confirmation, re-resolves
the catalog target, and only then closes the previous session. Notifications
for the already-open definition do not replace its session. The notification
response callback **awaits** `openRun`, retaining delivery order when several
taps arrive while a native dialog is open.

**Failure guarantees:** Cancel keeps the old session and failed-check-in retry
reachable. Leaving intentionally does not cancel work already accepted by the
RuntimeSession FIFO. A missing active screen guard blocks replacement; late
Alert callbacks and stale route identities cannot authorize another screen.

**Tests:** Shared leave guard covers duplicate requests, cancel/confirm,
save-start-after-dialog, stale route identity and dismissal cleanup. A
notification-source integration contract covers pending write + canceled tap,
failed write + canceled tap + successful retry, subsequent valid navigation,
sequential taps waiting for the first confirmation and obsolete approvals.
Native-device follow-up: exercise actual iOS/Android foreground notification
tap and Alert dismissal; the web E2E environment has no native notification
response adapter. No recurrence, medical, reminder or visual semantics changed.
