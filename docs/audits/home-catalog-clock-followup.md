# PR #15 follow-up — Home catalog/time snapshot

Constitution: C5, C9, C10, E3, E4

## Confirmed root cause

PR #15's event-boundary clock watch deliberately avoids React updates on ordinary
heartbeats. Home's memo invalidated when catalog/example inputs changed, but
reused the last clock-triggered state timestamp. Removing the last owned
scheduled Flow after hours on Home could therefore reveal an expired example
occurrence. Updating the timer deadline only arms a future timer; it does not
refresh the current projection. Copilot's 2026-10-08 07:26 UTC previously missed
finding remains valid on merged main `752db627` despite the later 0-open overview.

## C9 boundary and invariants

This is a UI clock-adapter concern. On each memo invalidation (clock, catalog,
or visible examples), sample wall time once and supply it to the existing pure
`projectHomeTime`. Project the header date from that same sample. Preserve memo
caching between invalidations and the single event-boundary/watchdog timer.
There is no new domain state, queue, dependency, recurrence rule or storage
change. Owned scheduled Flow precedence and the 24-hour visibility window remain
unchanged. PR #16 is already open; this narrow fix uses a separate branch.

## Verification

Add browser fake-clock regressions that keep the same Home mounted: seed an owned
22:00 Flow, advance from 09:00 to 15:00 without crossing its projection deadline,
then delete it. The newly visible example must show 22:00 immediately, never the
expired 14:00 occurrence. Also change wall time across midnight without firing
timers, delete the owned Flow, and require both the new date and the next example
occurrence to use the new time. No arbitrary sleeps or forced remounts.

Verified locally: `npm run check` passes both typechecks, lint and all 361
contract/golden tests; full `npm run test:e2e` passes 17/17 browser tests with
`E2E_CHROMIUM=/tmp/chromium` (Chromium 153). Both added regressions fail against
the unmodified main HomeScreen and pass with this change. All existing PR #15
tests remain enabled. Remote CI and Copilot must be checked on the final SHA.
Native AppState/timezone checks remain the device verification items documented
in the original audit.
