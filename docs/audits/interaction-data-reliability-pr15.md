# PR #15 — Interaction & Data Reliability audit

Constitution: C0, C5, C6, C9, C10, E3, E4, E6, AI-C1

## C9 — Boundaries and invariants

- **UI** owns presentation, a visible pending/failed check-in intent, retry and exit warning. It never owns an authoritative check-in table for writes, and may consume an async result only while its route/operation is current.
- **Application/session** owns accepted operation ordering and definition-scoped lifetime. Closing a session prevents new commands but drains accepted writes. An import already committed continues even when its screen disappears. The app shell revokes stale navigation synchronously.
- **Storage** owns authoritative read/modify/write of check-in records in one per-definition lane shared by the runtime session, backup merge, loads, and deletion. The write resolves only on a successful KV commit.
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
