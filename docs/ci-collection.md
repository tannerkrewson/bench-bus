# Daily refresh (GitHub Actions)

One workflow, `.github/workflows/refresh.yml`, runs at 5:07 PM America/New_York
and on `workflow_dispatch`. It replaces the old four collector workflows, each
of which started its own full deploy. The schedule uses `:07` because GitHub
documents delays at the start of each hour, and `timezone` so it follows DST.

`.github/scripts/daily-refresh.sh` does the work in one job:

1. **Collect and store** AA, OpenRouter, Cursor and DeepSWE. Each collector and
   the snapshot store validate and fail closed, so a failed source keeps its
   last-known-good snapshot.
2. **Commit and push** one commit to `bench-bus-data`.
3. **Typecheck and test**, only if `main` changed since the last publish (the
   `Source:` line in the `gh-pages` commit message). Data-only days skip this.
4. **Compile and build**, starting from the published `derived-data/` so history
   carries forward. The outgoing `latest.json` becomes a dated time-travel point
   once it is at least a week newer than the last dated one.
5. **Publish** `dist/` to `gh-pages` and request a Pages build.

If some sources fail, the others still publish and the run then fails, so the
failure shows in the Actions tab and GitHub's notification email. Nothing is
committed to `main`, so the job never triggers itself or other workflows.

GitHub disables schedules in a public repository after 60 days without repository
activity. Re-enable with `gh workflow enable refresh.yml` if that happens.

Public repositories get standard runners free, but the job is kept short anyway.

## Local testing (no network, no push)

```bash
# Structural checks on the workflow YAMLs (one daily schedule, permissions, wiring):
node .github/scripts/validate-workflows.mjs

# Full offline dry-run of collect -> snapshot -> commit against a fixture
# envelope in a throwaway repo, including the invalid-input fail-closed case:
node .github/scripts/dry-run-collect-flow.mjs
```

The fixture envelope lives at `.github/scripts/fixtures/sample-envelope.json`
and validates against the real Cursor snapshot schemas. The dry-run script
asserts the snapshot file lands at its deterministic path, the manifest's
`latestKnownGood` moves, the working tree is clean after commit, and a corrupt
envelope is rejected with the manifest left byte-identical.
