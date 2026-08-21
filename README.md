# bench-bus-data

Machine-generated snapshot storage for Bench Bus (benchb.us).
Maintained by GitHub Actions collectors — see docs/data-branch.md on the main branch.

- manifests/<source>.json — per-source index + latest-known-good pointer
- snapshots/<source>/v<schemaVersion>/<YYYYMMDDTHHMMSSZ>.json — immutable snapshots

Do not commit site artifacts or human-authored code here.
