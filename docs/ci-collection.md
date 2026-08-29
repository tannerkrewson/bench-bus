# Collection workflows (GitHub Actions)

Four scheduled workflows collect benchmark data, validate it, store it on the
dedicated `bench-bus-data` branch, and push. They never touch the deployed
site: the site build reads the data branch separately (see the deployment
workflow, owned separately).

| Workflow | Schedule (UTC) | Source | Concurrency group |
| --- | --- | --- | --- |
| `collect-openrouter.yml` | `0 1,5,9,13,17,21 * * *` (six times daily, UTC) | OpenRouter effective pricing | `collect-openrouter` |
| `collect-aa.yml` | `17 0,4,8,12,16,20 * * *` (six times daily, UTC) | Artificial Analysis models | `collect-aa` |
| `collect-cursor.yml` | `41 1,5,9,13,17,21 * * *` (six times daily, UTC) | Cursor eval table | `collect-cursor` |
| `collect-deepswe.yml` | `30 1,5,9,13,17,21 * * *` (six times daily, UTC) | DeepSWE leaderboard scores | `collect-deepswe` |

All four also support `workflow_dispatch` for manual recovery/testing.

## Scheduling caveat (important)

GitHub **scheduled workflows are best-effort**: during high-load periods runs
can be delayed significantly or skipped entirely. Bench Bus is built to
tolerate that — the frontend surfaces data freshness (observedAt per source)
instead of breaking, and a missed run simply means the previous
last-known-good snapshot stays in effect. Do not add alerting that treats a
missed cron as data corruption; use `workflow_dispatch` for recovery.

## Pipeline shape (shared composite action)

All four workflows delegate to `./.github/actions/collect-and-store`, which
runs, in order:

1. **Collect** — `npm run collect:<source> -- --out <temp envelope.json>`.
   Every collector fails closed: any upstream, parsing, or validation error
   exits nonzero and nothing downstream executes.
2. **Store** — `npm run snapshot -- write --dir data-branch --input <envelope>`.
   The snapshot store re-validates the entire envelope against the shared
   schemas, refuses to overwrite an existing snapshot path or duplicate
   manifest entry, writes the snapshot atomically, and only then appends the
   manifest entry and moves `latestKnownGood`. Empty collections are rejected
   by default so an upstream shape change cannot shadow known-good data with
   an empty "newer" snapshot.
3. **Commit** — `npm run snapshot -- commit --repo data-branch --message ...`.
   Guarded by `assertDataBranch`: refuses to commit unless `bench-bus-data`
   is the checked-out branch. A no-op commit is not an error.
4. **Push** — `git push origin HEAD:bench-bus-data` from the data-branch
   checkout.

Failure semantics: a failure at any step leaves the `bench-bus-data` checkout
untouched, so a push never happens and the remote data branch keeps its
previous last-known-good state. The workflow run itself fails (nonzero),
making the breakage visible in the Actions tab.

## Overlap safety

Each workflow has its own `concurrency` group with
`cancel-in-progress: false`, so overlapping runs of the same source queue
serially instead of racing on the data branch. Different sources use different
groups and different manifest namespaces (`manifests/<source>.json`), so they
can run concurrently without conflict; the snapshot store's duplicate-path and
duplicate-entry guards make even same-source double-writes safe.

## Permissions (least privilege)

- Workflow level: `contents: read` only.
- The single collect job escalates to `contents: write`, required solely for
  the data-branch push.
- The `main` checkout uses `persist-credentials: false`; only the
  `bench-bus-data` checkout persists credentials.

## Local testing (no network, no push)

```bash
# Structural checks on the workflow YAMLs (schedules, guards, permissions):
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

## Not here

The GitHub Pages deployment workflow is a separate concern (tracked
separately); this directory intentionally contains only collection workflows.
