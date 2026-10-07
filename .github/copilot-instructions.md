# Copilot code review instructions

Before reviewing, read `AGENTS.md`, `constitution/00-core.md`, `constitution/01-domain-model.md`, `constitution/03-engineering.md`, and `docs/architecture.md`. Review system-wide invariants before local symptoms.

This repository is **pre-release** and has never been run with user/test data. PR #5 intentionally resets the app-data format to the first public v1. Do not require compatibility with development-only storage keys or backup envelopes that never shipped.

Always check:

- **Catalog definition identity:** all state belonging to a specific Flow definition uses the versioned `(source, flowId)` definitionKey. Bare `flowId` is only the domain ID, never a runtime-state key.
- **No pre-release legacy layer:** there must be no bare-ID migration, alias, tombstone/quarantine registry, dual check-in namespace, or old backup compatibility in v1.
- **Persistence fail-closed:** read failure is not “missing data.” Never save empty state over a potentially unread Run/check-in log.
- **Immutable Run snapshot:** after a Run has events, replay/actions/UI use saved `run.flow`.
- **Mutation vs projection:** a committed business mutation is not reported as failed merely because catalog/reminder refresh fails.
- **Serialized catalog effects:** refresh/enroll/delete/mutation follow-up stay serialized through the catalog coordinator.
- **Durable deletion:** journal before destructive work; recovery is idempotent and deletion clears Flow, revisions, enrollment, Run, check-ins, and sequential timer notifications for that definition.
- **Notifications:** every newly scheduled notification carries definitionKey; route resolution requires an exact current definition match.
- **Backup v1:** backup contains only the first public format (flows, revisions, definition-keyed checkIns). Future compatibility should be added only after a format has actually shipped.

When you find one violation, inspect analogous call sites for the same root cause before reporting.
