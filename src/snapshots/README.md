# src/snapshots — historical snapshot storage

Machine-generated history lives on the dedicated `bench-bus-data` branch.
The convention, write protocol, failure semantics, and point-in-time
resolution rules are documented in [docs/data-branch.md](../../docs/data-branch.md).

Modules:

- `paths.ts` — deterministic branch/path conventions.
- `store.ts` — `DataBranchStore`: validated, immutable, append-only snapshot
  writes + manifest management + point-in-time resolution.
- `git.ts` — thin, injectable git integration used by Actions workflows.
- `cli.ts` — tsx CLI (`init` / `write` / `resolve` / `commit`).

Git branch creation/checkouts are owned by the caller; nothing here switches
branches.
