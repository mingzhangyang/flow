# Copilot code review instructions

Before reviewing, read `AGENTS.md`, `constitution/00-core.md`, `constitution/01-domain-model.md`, `constitution/03-engineering.md`, and `docs/architecture.md`. Review for architectural invariants first; do not stop at the first local symptom.

For this repository, always check these cross-cutting invariants:

- **Catalog definition identity:** runtime state that belongs to a specific Flow definition must be scoped by the versioned `(source, flowId)` catalog definition identity, not by bare `flowId`. This includes reminder enrollment, notification routes/identifiers, active Runs, scheduled check-ins, and run-screen component identity.
- **Conservative legacy migration:** bare-ID legacy data may migrate only when its source is unambiguous. Ambiguous shadowing must fail closed rather than attach state to the wrong definition.
- **Persistence fail-closed:** a read failure is not equivalent to “missing data.” Never allow a failed read to create/save empty state over potentially existing user data. Presence markers such as an explicitly stored empty check-in list are meaningful state and must survive backup/restore.
- **Immutable Run snapshot:** after a Run has events, replay/actions/UI must use the saved `run.flow` snapshot. Editing the catalog Flow must not mutate an in-progress Run’s definition.
- **Mutation vs projection:** a business mutation that has already committed must not be reported as failed merely because follow-up catalog reload or reminder rescheduling failed. Projection failure belongs to the catalog error/retry state.
- **Serialized catalog side effects:** catalog refresh, enrollment, deletion, and mutation follow-up must remain serialized through the catalog coordinator so notification cancel/schedule operations cannot race.
- **Durable deletion:** destructive deletion is commit-forward. Persist the minimal deletion intent before destructive writes; once that journal write succeeds, recovery must be idempotent and survive process/storage failures.
- **Notifications:** newly scheduled notifications must carry definition identity. A stale delivered notification must never route to a different same-ID definition.
- **Open-format compatibility:** changes to persisted/exported data must be additive or explicitly migrated. Older backups and legacy on-device data must remain readable without silently misassigning state.

When one violation is found, inspect analogous call sites and adjacent persistence/backup/notification paths for the same root cause before reporting. Prefer one root-cause finding that identifies all affected paths over several symptom-level comments.
