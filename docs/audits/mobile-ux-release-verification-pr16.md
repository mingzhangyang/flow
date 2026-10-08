# PR #16 — Mobile UX & Release Verification

Baseline main after PR #15: 752db6271238da79bafe80ffe43de6b0f42db0e4.
Layers: UI/shared controls, web E2E, CI/native build and release documents.
No change to domain, schema, Runtime event semantics, Check-in durability,
OperationScope, recurrence, notification planning, visuals or motion semantics.

## Audit before modification

| Classification | Verified evidence |
|---|---|
| Confirmed UX omissions | Home Edit/Share/Delete/Insight used plain text-sized Pressables; Generate provider/preset chips had no minimum area. Move geometry into mobileControls. |
| Confirmed layout omissions | Home cards/header and toolbar needed wrapping/shrinking; Generate provider row needed wrapping, Schedule/Timeline text flex children needed minWidth:0. |
| Already correct | Editor bottom Save/Back/44dp chips, Schedule Check-in/Undo, Runner secondary buttons, PR #15 confirmed persistence, navigation guards, time/zone projection. Avoid redesign. |
| Test-only gaps | Existing fixed-clock screenshots lacked 320dp, Editor/Generate coverage, ready/committed-state checks, geometry assertions, and CI evidence. |
| Native-only, unverified | Keyboard/Back/Safe Area, OS notifications, device font scaling/screen readers, Doze, app kill/reboot, Keystore/Keychain and EAS signed preview. |
| Separate release blocker | usePersistentRun.ts still silently catches sequential Run snapshot save failures. A dedicated follow-up is required; do not redesign Run-event semantics in this PR. |

## Change boundaries

- mobileControls owns shared minimum 44/48dp hit geometry, including Home
  text actions without overlapping hitSlop. MotionPressable defaults to a
  semantic button role/state, preserving style transforms and feedback.
- Presentation-only flex minWidth/wrap, scroll/keyboard insets, and primary
  control sizes preserve Visual System v2; no hidden copy or smaller fonts.
- Browser geometry at four widths (320/360/393/430), three locales and two
  color schemes; screenshot smoke at 320/430 with fixed clock, confirmed
  check-in, reduced motion, six screens and uploaded artifacts.
- Screenshot smoke reuses the E2E web export, without duplicating Expo build.
- Android clean prebuild, expo install/doctor, release lint and APK assemble
  evaluate unmodified generated resources; remove workflow sed workaround.
- Native test APK artifact contains source commit and SHA256 checksum,
  never promises persistent EAS signing. EAS remains manual/no new keys.

## Evidence status

Evidence below is recorded against PR head
`720a9a2bfb307e135e13c0681174ae3cfd63613a`.

| Gate | Result |
|---|---|
| npm run check | Passed — [check run #294](https://github.com/mingzhangyang/flow/actions/runs/37753823013), `check` job |
| npm run test:e2e (+ PR #15 regressions) | Passed, 42/42 — [check run #294](https://github.com/mingzhangyang/flow/actions/runs/37753823013), `e2e` job |
| 320/360/393/430 browser geometry, zh/zh-Hant/en, light/dark | Passed — [check run #294](https://github.com/mingzhangyang/flow/actions/runs/37753823013), `e2e` job |
| Browser screenshot smoke (six screens, 320/430, three languages) | Passed, 36/36 — [check run #294](https://github.com/mingzhangyang/flow/actions/runs/37753823013), `e2e` job |
| Screenshot artifact available | `flow-mobile-screenshots`, artifact [#11539591163](https://github.com/mingzhangyang/flow/actions/runs/37753823013/artifacts/11539591163), digest `sha256:c972bac9128e23d36759cb01a13d0d53e3d893eab67a53f53049438fc4502cb3` |
| expo install --check / expo-doctor | Passed — [Android run](https://github.com/mingzhangyang/flow/actions/runs/37753817953), `Build standalone test APK` job |
| Native prebuild / lintRelease / assembleRelease | Passed — [Android run](https://github.com/mingzhangyang/flow/actions/runs/37753817953), `Build standalone test APK` job |
| APK provenance, actual signature state | Passed — source commit `720a9a2bfb307e135e13c0681174ae3cfd63613a`, v2 verified; artifact `flow-android-standalone-test-apk` [#11539129063](https://github.com/mingzhangyang/flow/actions/runs/37753817953/artifacts/11539129063) includes `source-commit.txt`, `SHA256SUMS`, and required `signature.txt` |
| Android/iOS real-device matrix | Unverified, no connected device |
| Android exact alarms / Doze / OEM limitations | Unverified release risk |
| Sequential Run optimistic save | Confirmed public release blocker — dedicated follow-up required |

## Release conclusion

An APK built from current head enables **full Android device testing**.
A successful build and web test cannot establish public/store release
readiness. Until native notification behavior is verified and sequential Run
persistence is fixed, do not claim release ready.

Constitution: C4, C5, C6, C9, C10, E3, E4, E6.
