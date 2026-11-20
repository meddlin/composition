# Android app

The Android app for phones and tablets: Kotlin throughout, Jetpack Compose for the screens. The design is
[docs/android-app-design.md](../../docs/android-app-design.md). **So far only the Kotlin core exists, in slices**: spike A1, then search, MDX, images and the typing aids here,
and the rest of the port in PRs #350 to #355, stacked on this one. There is no app yet.

| Module | What |
|---|---|
| `core` | The Kotlin core: a port of the iPad's `CompositionCore` (`apps/ios/CompositionCore`), checked against the desktop's own code by the shared corpus in `fixtures/conformance/`. No Android framework dependency, so its tests run on the Mac's JVM. So far: the schema pass, notes, groups, notebooks, the Trash Can, frontmatter (with a port of the iPad's `js-yaml` port), settings, backup and restore, search (the query parser, Meilisearch's typo rules, and the FTS5 index the store keeps in step), the MDX scanner with the component helpers, and images (storing, naming, the note's references, Markdown images to `<Image />`, the stored-image list and picker, the header image's source and clean-up), and the typing aids (completion lists, note links, indenting, emphasis, the highlight, and Return and Backspace in lists and quotes). |
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
down again afterwards. Then the desktop restores the backups the core wrote on the device. Only one run at a time uses the emulator:
the script takes a lock (`~/.android/composition-device-tests.lock`), and a second run waits for it.

CI (`.github/workflows/android-core.yml`) runs `conformance.sh` on Linux with `COMPOSITION_JVM_ONLY=true`, which leaves the device
module out of the Gradle build, and checks that no invisible characters are in the sources.

Without `COMPOSITION_CONFORMANCE_DIR`, `./gradlew :core:test` reports the conformance suites as skipped, never as passed.

## Notes for whoever ports the next slice

- **Port from the Swift, check against the corpus.** Each Swift suite in `apps/ios/CompositionCore/Tests` has a Kotlin twin with the same
  name. A slice is done when its suites pass on the JVM and on the device.
- **Use `kotlin.test.Test`**, not JUnit 5's, and no parameterized tests. The same sources run under JUnit 5 on the JVM and JUnit 4 on Android.
  Skip with `skipUnless(condition, reason)`, which each runner reports as skipped.
- **In a property getter, `field` is the property's own backing field.** Write `this.field` for a member called `field`.
- **Format numbers with `Locale.ROOT`.** Kotlin's `String.format` follows the device's locale, and some locales write other digits.
  Swift's `String(format:)` doesn't follow the locale.
- **Kotlin's `Int` is 32 bits; Swift's is 64.** Where a Swift `Int` holds a number from a note or a file, use `Long`.
- **Don't lean on the platform for text rules.** A JVM's regex `\s` is ASCII, Android's is ICU's, and Swift's `URLComponents` has no twin. Write the
  character class or the reader out, as `ParsedUrl` does. `markdown/JavaScriptPatterns.kt` holds JavaScript's `\s` (`JS_SPACE`, and
  `JS_SPACE_CHARS` for inside a class), its `.` (`JS_ANY`) and the desktop's `insideFence`: use them when porting a desktop pattern.
- **A JVM regex's `$` also matches before a final line break.** Write `\z` where JavaScript wrote `$` without the `m` flag.
- **No case-insensitive flags: use `AsciiCaseless`.** JavaScript's `i` folds only A to Z. Kotlin's `IGNORE_CASE` folds all of Unicode
  (`ſ` matches `s`), and so does Android's `(?i)`, although a JVM's doesn't. Write the pattern in lower case and wrap it in `AsciiCaseless`
  (`markdown/JavaScriptPatterns.kt`), which runs it on the text with only A to Z lowered.
- **Write `\u2028`, not the character.** Invisible characters (line separators, no-break spaces, zero-width joiners, soft hyphens, combining
  marks) are written as escapes in the sources. `scripts/escape-invisible-characters.py` rewrites any that get in, and CI fails on them.
  Some editing tools turn an escape into the character, in a file or a shell heredoc alike, and a lone surrogate's escape into U+FFFD.
- **Say how a conformance suite did in one line ending "agree with the desktop"** (`Lists, Return: 2104 of 2104 caret places agree with
  the desktop`). The device script shows those lines from the emulator's log.
- **A test must return `Unit`.** JUnit 5 does not run a test method that returns a value (an expression body that ends in a call
  returning something): it logs a warning and the test silently never runs. Android's JUnit 4 calls it an error. Write
  `fun name(): Unit = withScratch { ... }` or a block body.
- **No regex with `*/` in a KDoc comment.** `/\s*[\r\n]+\s*/` ends the comment early; write such patterns in `//` comments.
- **Run a pattern over a long text with one matcher.** Kotlin's `findAll` makes a `Matcher` per match, and on Android each one copies the
  whole text. Use `forEachMatch` (`markdown/JavaScriptPatterns.kt`).
- **Swift's rules, spelled out.** `rounded()` is half away from zero (not `floor(x + 0.5)`, not Kotlin's `round`); `min` and `max` pass a NaN
  over; `Int(_:)` takes ASCII digits only (Kotlin's `toIntOrNull` takes other scripts' too); a `Character` is a grapheme cluster. For
  JavaScript's `toFixed`, use `BigDecimal(double)`, not `String.format`. kotlinx's `booleanOrNull` reads the text `"true"` as `true`.
- **SQL text that ends up in `sqlite_master` is copied character for character.** `SqlScript` splits a block the way GRDB's `execute`
  runs it, so a trigger's body stays whole.
