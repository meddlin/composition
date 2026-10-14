# Deployment Setup

Prerequisites:

- After creating Apple developer certs and keys.
- 

## Environment Setup Wizard

## Release & Deploy Commands

Goal: Create a new release for the desktop app by pushing a tag, `desktop-vX.Y.Z`

Create a new branch for the release

```sh
git checkout -b chore/release-v0.x.x
```

Move to the desktop directory, and increment the version number.

```sh
cd apps/desktop
npm version patch --no-git-tag-version   # or minor / major
```

Run tests

```sh
pnpm test:desktop
```

Commit and push the branch

```sh
git add apps/desktop/package.json
git commit -m "chore: release desktop v0.1.3"
git push -u origin chore/release-v0.1.3
```

Open a PR and merge into `main`

```sh
gh pr create --fill
```

Tag the merged commit on `main`, and push the tag

```sh
git checkout main
git pull
git tag desktop-v0.1.3
git push origin desktop-v0.1.3
```