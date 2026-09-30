# Repository rules

## GitHub Actions must be pinned to commit SHAs

Tags and branches are mutable, so every `uses:` in `.github/workflows/` (and `.github/actions/`) must reference an immutable full-length commit SHA, followed by a version comment:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

- Never write `@v4`, `@main`, or a short SHA. The comment must be the exact release tag the SHA belongs to (`# v4.4.0`), so Dependabot/Renovate can update both together.
- Resolve the SHA of the **commit**, not the tag object. Annotated tags (e.g. `pnpm/action-setup`) point at a tag object; use `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`.
- Local actions (`./...`) are exempt. `docker://` images must be pinned to `@sha256:<digest>`.
- Enforced by `pnpm lint:actions` ([scripts/lint-github-actions.mjs](scripts/lint-github-actions.mjs)), which also runs in CI. Run it after touching any workflow.
