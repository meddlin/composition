# Android app

The Android app for phones and tablets: Kotlin throughout, Jetpack Compose for the screens. The design is
[docs/android-app-design.md](../../docs/android-app-design.md). **So far only the first slice of the Kotlin core exists** (spike A1);
there is no app yet.

| Module | What |
|---|---|
| `core` | The Kotlin core: a port of the iPad's `CompositionCore` (`apps/ios/CompositionCore`), checked against the desktop's own code by the shared corpus in `fixtures/conformance/`. No Android framework dependency, so its tests run on the Mac's JVM. So far: the schema pass, notes, groups, notebooks, the Trash Can, frontmatter (with a port of the iPad's `js-yaml` port), settings, and backup and restore. |
| `core-device-tests` | No code of its own: runs `core`'s test sources on an emulator or a device, through Android's test runner. |

## Running the checks

Both need the web app's dependencies (`cd apps/web && pnpm install --frozen-lockfile`), which generate the desktop's fixtures, and a JDK 21
(the scripts use Android Studio's own when `JAVA_HOME` is not set).

```bash
apps/android/scripts/conformance.sh
```

The desktop writes its fixtures, the Kotlin core replays them on the Mac's JVM, and the desktop restores the backups the Kotlin core
wrote. This is the counterpart of `apps/ios/scripts/conformance.sh`.

```bash
apps/android/scripts/test-on-device.sh
```

The same suites on Android: on the device `adb` sees, or on the `Pixel_10` emulator (another with `AVD=`), booted headless and shut
down again afterwards. Then the desktop restores the backups the core wrote on the device.

Without `COMPOSITION_CONFORMANCE_DIR`, `./gradlew :core:test` reports the conformance suites as skipped, never as passed.

## Notes for whoever ports the next slice

- **Port from the Swift, check against the corpus.** Each Swift suite in `apps/ios/CompositionCore/Tests` has a Kotlin twin with the same
  name. A slice is done when its suites pass on the JVM and on the device.
- **Use `kotlin.test.Test`**, not JUnit 5's, and no parameterized tests. The same sources run under JUnit 5 on the JVM and JUnit 4 on Android.
- **Format numbers with `Locale.ROOT`.** Kotlin's `String.format` follows the device's locale, and some locales write other digits.
  Swift's `String(format:)` doesn't follow the locale.
- **SQL text that ends up in `sqlite_master` is copied character for character.** `SqlScript` splits a block the way GRDB's `execute`
  runs it, so a trigger's body stays whole.
