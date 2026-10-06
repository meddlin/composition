# Signing and notarizing the desktop app by hand

How to get an Apple signing certificate, install it, and use it to produce a signed and
notarized build of the Electron app on your own Mac. This is the one-time setup plus the
repeatable build. For the surrounding steps (pull, test, smoke test, publish to GitHub
Releases) see [desktop-build-and-release.md](../desktop-build-and-release.md); for the command
reference see [apps/desktop/README.md](../../apps/desktop/README.md).

**macOS only.** Signing needs a paid Apple Developer Program membership. Unless a step says
otherwise, run commands from `apps/desktop`.

**Status.** A signed and notarized DMG built with this process was installed to
`/Applications`, opened without a Gatekeeper warning, and search worked. The `codesign`,
`spctl` and `stapler` checks in [Verify the build](#4-verify-the-build) all passed on the arm64
build (2026-10-05).

## How signing works

Two separate steps, and a download opens without a warning only if both happen.

1. **Code signing** attaches a signature to every executable inside the `.app`, made with a
   **Developer ID Application** certificate. It proves who built the app and that it hasn't
   changed since.
2. **Notarization** uploads the signed app to Apple, which scans it automatically and returns a
   ticket. electron-builder staples the ticket to the app, and Gatekeeper then accepts it.

Hardened runtime is required for notarization. It is already on (`hardenedRuntime: true` in
[electron-builder.yml](../../apps/desktop/electron-builder.yml)).

## What you need

| Thing | What it is for | Where it lives |
|---|---|---|
| Developer ID Application certificate **and its private key** | Signing | Login keychain on this Mac |
| Developer ID - G2 intermediate certificate | Makes the certificate trusted | Login keychain |
| App Store Connect API key (`.p8` file, Key ID, Issuer ID) | Notarization | A file outside the repo, plus three environment variables |

## 1. Get and install the signing certificate (one time)

### 1.1 Create a certificate signing request (CSR)

This also creates the private key, **on this Mac**. Do it on the Mac you will build on.

1. Open Keychain Access.
2. Choose Keychain Access > Certificate Assistant > **Request a Certificate From a Certificate
   Authority**.
3. Enter your email and a Common Name, leave the CA Email field empty, choose **Saved to
   disk**, and save the `.certSigningRequest` file.

The Common Name becomes the label of the private key (ours shows as "Rushing Labs Development
Key" in password prompts). It does not have to match the certificate's name.

### 1.2 Issue the certificate in the Apple Developer portal

1. Go to [developer.apple.com/account](https://developer.apple.com/account) > Certificates,
   Identifiers & Profiles > Certificates > **+**.
2. Choose **Developer ID Application** (under Software). Not "Apple Development", not "Apple
   Distribution", and not "Developer ID Installer".
3. Upload the CSR, then download the `.cer` file.

Only the Account Holder can create Developer ID certificates.

### 1.3 Install the certificate into the **login** keychain

In Keychain Access, click **login** in the sidebar first, then choose File > Import Items and
pick the `.cer`. Check that the Keychain dropdown says **login**.

Or from the terminal:

```bash
security import ~/Downloads/developerID_application.cer -k ~/Library/Keychains/login.keychain-db
```

Don't double-click the `.cer` while **iCloud** is selected in the sidebar. The iCloud keychain
holds passwords only, and the import fails with `Error: -25294` (`errSecNoSuchKeychain`).

### 1.4 Install the Developer ID - G2 intermediate certificate

If the certificate shows "not trusted" or "unknown issuer", download **Developer ID - G2**
from [apple.com/certificateauthority](https://www.apple.com/certificateauthority/) and install
it into the login keychain the same way. Recent macOS versions often have it already.

### 1.5 Check it

In Keychain Access, open **login** > **My Certificates**. "Developer ID Application: Your Name
(TEAMID)" must have a disclosure arrow, with a private key nested under it. Then:

```bash
security find-identity -v -p codesigning
```

Expected output is one valid identity:

```
1) 8FCDC2448C12D893E5AA3C46C361498D55EEEE59 "Developer ID Application: Darrien Rushing (49W52J9ZLN)"
   1 valid identities found
```

`0 valid identities found` usually means one of: no private key (see below), the certificate
is untrusted (install the G2 intermediate), or it is in the wrong keychain.

## 2. Create the notarization credentials (one time)

1. In [App Store Connect](https://appstoreconnect.apple.com) go to Users and Access >
   Integrations > **Team Keys** and click **+**.
2. Name it (for example "composition-notarize") and give it the **Developer** role.
3. Download the `.p8` file. **Apple lets you download it once.** Keep it in a password manager
   and in a directory outside the repo, such as `~/.private_keys/`.
4. Note the **Key ID** (in the key's row) and the **Issuer ID** (top of the Keys page).

Never commit the `.p8` file. If it leaks, revoke the key in App Store Connect and create a new
one: that doesn't affect the certificate or apps already released.

## 3. Build a signed and notarized app

Set the three notarization variables for this shell, fetch Meilisearch for the architecture you
are building, and run the build:

```bash
export APPLE_API_KEY=~/.private_keys/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

cd apps/desktop
pnpm fetch:meilisearch mac-arm64     # once per architecture; omit the argument for both
pnpm dist
```

What happens:

- electron-builder finds the Developer ID Application identity in your login keychain and signs
  every executable in the bundle, including the Meilisearch binary and the better-sqlite3
  `.node` files. You do **not** set `CSC_LINK` or `CSC_KEY_PASSWORD` for a local build. Those
  are for CI, where there is no login keychain.
- It then submits the app to Apple and waits. The first submission can take several minutes.
- Output lands in `apps/desktop/release/`: the DMG, the ZIP and `mac-arm64/Composition.app`.

Credentials come from the environment only, never from files in the repo.

For an Intel build, fetch `mac-x64` Meilisearch and add `--x64` (`pnpm exec electron-builder --x64`
after `pnpm build`).

### Or: one command for both architectures

`pnpm release` runs everything a release needs, and it is the same script the
[GitHub Actions workflow](#5-release-from-github-actions) runs, so a local run and a CI run
produce the same thing. With the three `APPLE_API_*` variables exported:

```bash
cd apps/desktop
pnpm release                    # install, fetch Meilisearch, build, sign, notarize, verify, checksum
```

| Option | What it does |
|---|---|
| `--check` | Checks the requirements and builds nothing. Run this first. |
| `--arch arm64` or `--arch x64` | Build one architecture instead of both. |
| `--unsigned` | Skip signing and notarization, for a test build. Never publish the result. |
| `--tag desktop-v0.1.0` | Also require `apps/desktop/package.json`'s version to match the tag. |

Before building it checks the requirements from this document and prints each problem with the
fix. A **MISSING** item stops the build, and a **warning** doesn't:

| Reported | Meaning | Fix |
|---|---|---|
| MISSING: no Developer ID Application identity | The certificate or its private key isn't in your keychains | [Step 1](#1-get-and-install-the-signing-certificate-one-time) |
| MISSING: identity is installed but not valid | Developer ID - G2 intermediate missing, or the certificate expired | [Step 1.4](#14-install-the-developer-id---g2-intermediate-certificate) |
| MISSING: `APPLE_API_KEY`, `APPLE_API_KEY_ID` or `APPLE_API_ISSUER` not set | No notarization credentials | [Step 2](#2-create-the-notarization-credentials-one-time) |
| MISSING: `APPLE_API_KEY` points to a file that doesn't exist | Wrong path to the `.p8` | Check `ls "$APPLE_API_KEY"` |
| MISSING: tag doesn't match the `package.json` version | Only with `--tag` | Fix the version or the tag |
| warning: the `.p8` is inside the repository | It could be committed by accident | Move it to `~/.private_keys/` |
| warning: several Developer ID identities | electron-builder picks one | Set `CSC_NAME` |
| warning: uncommitted changes, or not on `main` | The build won't match a release commit | Commit, or switch to `main` |
| warning: `appId` still PROVISIONAL | Part of the code signature | [Can I change the app identifier later?](#can-i-change-the-app-identifier-later) |
| warning: Node below 22.14 | Recommended for the web build | Switch Node versions |

The script deletes `apps/desktop/release/` at the start so old artifacts can't end up in a
release. When it finishes, the DMGs, ZIPs and `SHA256SUMS.txt` are in `release/`, and every app
has passed the checks in the next step. It stops with a non-zero exit code if any check fails.

## 4. Verify the build

`pnpm release` already runs these checks on every app it builds. To run them by hand:

Run these from `apps/desktop`, against the `.app` in `release/`:

```bash
APP=release/mac-arm64/Composition.app
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute --verbose "$APP"
xcrun stapler validate "$APP"
```

`APP` is just a shell variable holding the path to the built app, so each command stays short.
For an Intel build, point it at the folder electron-builder created for that architecture
(`ls release`). Each command checks a different thing, and all three have to pass:

| Command | What it checks | A pass looks like |
|---|---|---|
| `codesign --verify --deep --strict --verbose=2 "$APP"` | **The signature is intact.** `--deep` checks the helper apps, frameworks and binaries nested inside the bundle (Electron Framework, the Meilisearch binary and so on) as well as the app itself. `--strict` applies the stricter validation rules. `--verbose=2` prints each nested item as it is checked, which is why this command produces a long list of `--prepared` and `--validated` lines. It fails if any file was changed or added after signing, or if something in the bundle isn't signed. It does **not** tell you who signed the app or whether it was notarized. | `valid on disk` and `satisfies its Designated Requirement` |
| `spctl --assess --type execute --verbose "$APP"` | **Gatekeeper would let it run.** `spctl` is the command-line front end to the same policy check macOS runs when a user opens a downloaded app. `--type execute` asks "may this be launched?". The `source=` line says which rule allowed it. | `accepted` and `source=Notarized Developer ID` |
| `xcrun stapler validate "$APP"` | **The notarization ticket is attached to the app.** After Apple notarizes a build, electron-builder staples the ticket into the `.app`. A stapled ticket lets Gatekeeper accept the app **offline**; without it, the check needs to reach Apple's servers. `xcrun` runs `stapler` from Xcode's command line tools. | `The validate action worked!` |

How to read a failure:

- `spctl` printing `source=Developer ID` without `Notarized` means the app is signed but was not
  notarized. `rejected` means it isn't safe to distribute: users would see a Gatekeeper warning.
- `codesign` failing means the signature is broken or missing somewhere in the bundle. Rebuild
  rather than trying to fix it by hand.
- `stapler` failing while `spctl` passes means notarization succeeded but the ticket wasn't
  stapled. The app opens for users who are online, but rebuild before releasing.

Optional: to see **who** signed it, run:

```bash
codesign -dv --verbose=2 "$APP" 2>&1 | grep -E "Authority|TeamIdentifier|flags"
```

This prints the certificate chain (`Authority=Developer ID Application: <you> (<TEAMID>)`, then
`Developer ID Certification Authority` and `Apple Root CA`), your Team ID, and
`flags=0x10000(runtime)`, which means hardened runtime is on. The `2>&1` is there because
`codesign` writes this report to stderr, and `grep` only reads stdout.

Then the test that matters most: open the DMG, drag the app to Applications, launch it, and check
that search works. Search proves the signed Meilisearch child process runs under hardened
runtime.

Next steps are in [desktop-build-and-release.md](../desktop-build-and-release.md#8-publish-to-github-releases).

## 5. Release from GitHub Actions

[.github/workflows/release-desktop.yml](../../.github/workflows/release-desktop.yml) builds,
signs and notarizes both architectures on a macOS runner and attaches them to a **draft** GitHub
Release. It runs `pnpm release`, the script from step 3.

**It only runs when you push a `desktop-v*` tag.** Pushing a branch, opening a pull request or
merging to `main` never starts it, and it has no schedule or manual trigger. (This repository is
public, where standard GitHub-hosted runner minutes, macOS included, are free. If it ever goes
private, macOS minutes count ten times against your allowance, which is one more reason the
trigger is a deliberate tag.)

### One-time setup: the secrets

A runner has no login keychain, so the certificate travels as a base64 `.p12` file and
electron-builder imports it into a temporary keychain for the run.

1. **Export the certificate and key.** In Keychain Access, open **login** > **My Certificates**,
   right-click "Developer ID Application: ..." and choose Export. Save it as a `.p12` and set a
   strong password. Exporting from My Certificates includes the private key; a `.cer` alone
   can't sign.
2. **Create the `release` environment**, which holds the secrets so only this workflow can read
   them. In the repository, go to Settings > Environments > New environment > `release`. Optional:
   add yourself under **Required reviewers**, and the workflow then waits for your approval
   click before the macOS job starts.
3. **Add the five secrets to that environment**, then delete the `.p12` from disk or move it into
   your password manager:

   ```bash
   base64 -i DeveloperID.p12 | gh secret set CSC_LINK --env release
   gh secret set CSC_KEY_PASSWORD --env release        # prompts for the .p12 password
   gh secret set APPLE_API_KEY_P8 --env release < ~/.private_keys/AuthKey_XXXXXXXXXX.p8
   gh secret set APPLE_API_KEY_ID --env release        # prompts
   gh secret set APPLE_API_ISSUER --env release        # prompts
   ```

   | Secret | What it is |
   |---|---|
   | `CSC_LINK` | The base64 `.p12` (certificate and private key) |
   | `CSC_KEY_PASSWORD` | The password you set when exporting the `.p12` |
   | `APPLE_API_KEY_P8` | The **contents** of the `.p8` file. The workflow writes it to a temporary file, because `notarytool` reads the key from a path, and removes it at the end |
   | `APPLE_API_KEY_ID` | The API key's Key ID |
   | `APPLE_API_ISSUER` | The Issuer ID |

### Cutting a release

1. Set `"version"` in `apps/desktop/package.json`, and merge that to `main`.
2. Tag the commit on `main` and push **that one tag**:

   ```bash
   git checkout main && git pull
   git tag desktop-v0.1.0
   git push origin desktop-v0.1.0
   ```

   Don't use `git push --tags`: it pushes every local tag, and any `desktop-v*` one among them
   would start a release.
3. Watch it: `gh run watch`. A first check on a cheap Linux runner fails fast if the tag doesn't
   match the `package.json` version, or points at a commit that isn't on `main`. Then the macOS
   job installs, builds both architectures, signs, notarizes, verifies and creates the draft.
4. Check the draft (`gh release view desktop-v0.1.0 --web`), download the DMG from it onto a Mac
   that hasn't built the app, open it and check search. Then publish:
   `gh release edit desktop-v0.1.0 --draft=false`.

If it fails before the draft exists, fix the cause and use **Re-run failed jobs** on the run. If
the tag itself was wrong, delete it (`git push origin :refs/tags/desktop-v0.1.0` and
`git tag -d desktop-v0.1.0`) and tag again. If a draft was already created, delete it first
(`gh release delete desktop-v0.1.0 --yes`).

### How it differs from a local build

| | Local `pnpm release` | GitHub Actions |
|---|---|---|
| Signing certificate | The identity in your login keychain | `CSC_LINK` and `CSC_KEY_PASSWORD`, imported to a temporary keychain |
| Notarization key | `APPLE_API_KEY` is a path to your `.p8` | The `APPLE_API_KEY_P8` secret, written to a temporary file |
| Intel (x64) build | Cross-built on your Mac | Cross-built on the Apple Silicon runner, in the same job |
| Keychain password prompt | Yes: click Always Allow | No |
| Creates the GitHub Release | No: use the runbook's step 8 | Yes, as a draft |
| Unit tests and smoke test | Not run | Not run. Pull requests run the unit tests ([unit-tests.yml](../../.github/workflows/unit-tests.yml)) |

Every `uses:` in the workflow is pinned to a commit SHA ([AGENTS.md](../../AGENTS.md)); run
`pnpm lint:actions` after touching it. The workflow has only been checked by parsing and by that
lint. Its first real run is the test, so expect to fix a small thing.

## Questions and answers

### What is the password `codesign` asks for?

Your **login keychain password**, which is normally the same as your Mac account password. The
private key sits in the login keychain, and `codesign` has to ask the keychain for permission to
use it. The dialog reads "codesign wants to sign using key ... in your keychain". Enter the
password and click **Always Allow**. A plain Allow can make you do it again for every binary
in the bundle. It is not your Apple ID password, and it is not the API key.

If the password is rejected, your keychain password may have drifted from your account password
(for example after an account password reset). In Keychain Access, select **login** and choose
Edit > Change Password for Keychain "login", entering the old keychain password and then the new
one. If you don't remember the old one, the only recovery is resetting the keychain, which deletes
the certificate and key; you would then issue a new certificate from a new CSR.

### The key in the password prompt has a different name from my certificate. Is that right?

Yes. The private key is labeled with the Common Name from your CSR, not with the certificate's
name. To confirm, expand the certificate under My Certificates: the key nested under it should
carry that label.

### Keychain Access says `Unable to import ... Error: -25294`.

You were importing into the iCloud keychain, which can't hold certificates. See
[1.3](#13-install-the-certificate-into-the-login-keychain).

### The certificate says "not trusted", or `find-identity` shows 0 valid identities.

Install the Developer ID - G2 intermediate ([1.4](#14-install-the-developer-id---g2-intermediate-certificate)).
If the certificate has no private key under it, the CSR came from a different Mac or the key was
deleted. The key can't be recovered: revoke the certificate in the Developer portal, make a new
CSR on this Mac, and issue a new certificate.

### Which certificate type do I need?

**Developer ID Application**, for apps distributed outside the Mac App Store, such as a DMG on
GitHub Releases. "Apple Development" and "Apple Distribution" are for other purposes.

### Is the App Store Connect API key meant for shipping builds? It warned about internal use.

Yes, it is the supported way to notarize from automation. The warning is about who holds the
key: a Team Key acts with your team's permissions against Apple's APIs, so treat it as a secret.
It is used on the build machine to authenticate to Apple's notary service. It never goes into the
`.app`, the DMG or the GitHub release. Users receive the notarization ticket stapled into the
app and never touch the key. Give the key the Developer role, keep the `.p8` out of the repo, and
revoke it if it leaks.

An alternative is an Apple ID with an app-specific password (`APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). It ties the build to a personal account and the
password grants broader access, so prefer the API key.

### Notarization failed or was rejected. How do I see why?

Find the submission ID in the build output (or list recent ones), then fetch Apple's log, which
names the exact binary and reason:

```bash
xcrun notarytool history --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"
xcrun notarytool log <submission-id> --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"
```

### Why does the build fail at `extraResources`?

The Meilisearch binary for the architecture being built is missing. Run
`pnpm fetch:meilisearch` first ([step 6 of the release runbook](../desktop-build-and-release.md#6-fetch-meilisearch-and-package-the-app)).

### Can I change the app identifier later?

Avoid it. `appId` in `electron-builder.yml` is part of the code signature and decides where macOS
stores app preferences, so changing it after release orphans existing installs. It is marked
provisional in that file: settle it before the first public release.

### Does any of this cover Windows?

No. Your Apple membership doesn't sign Windows builds, and the desktop app targets macOS only
for now.
