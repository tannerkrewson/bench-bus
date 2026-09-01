# Deploying Bench Bus to GitHub Pages (benchb.us)

Bench Bus is a fully static Vite application. Deployment uses the official
GitHub Actions Pages artifact flow (`actions/configure-pages`,
`actions/upload-pages-artifact`, `actions/deploy-pages`). **No `gh-pages`
branch exists or is used** — compiled output is never committed to any branch.

## One-time human activation checklist

The deployment workflow (`.github/workflows/deploy.yml`) is fully wired, but
Pages itself must be activated by a human with admin access:

1. **Repository visibility.** The repo is currently private. GitHub Pages
   (including via Actions) requires the repository to be **public** on the
   free plan (or a paid plan with private Pages). Make the repo public when
   ready: Settings → General → Danger Zone → Change visibility.
2. **Enable Pages with the Actions source.** Settings → Pages →
   "Build and deployment" → Source: **GitHub Actions**. Do NOT choose
   "Deploy from a branch" — that would require a `gh-pages` branch, which this
   project intentionally avoids.
3. **Custom domain.** Settings → Pages → Custom domain: enter `benchb.us` and
   save. This must match `public/CNAME` (contents: `benchb.us`), which the
   build gate verifies is present in the deployed artifact.
4. **DNS records** at the benchb.us DNS provider (apex domain):
   - `A` records for `benchb.us` → GitHub Pages IPs:
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - (optional but recommended) `AAAA` records for the same names' IPv6
     equivalents: `2606:50c0:8000::153` … `2606:50c0:8003::153`
   - If `www.benchb.us` should also resolve, add a `CNAME` record
     `www` → `benchb.us`.
   - GitHub verifies domain ownership from Settings → Pages once DNS
     propagates.
5. **HTTPS enforcement.** After DNS verification succeeds, tick
   "Enforce HTTPS" on the Pages settings page (it can take a few minutes for
   the certificate to provision).
6. **Run the deploy.** Trigger `.github/workflows/deploy.yml` via
   `workflow_dispatch` (Actions → Deploy to GitHub Pages → Run) or push to
   `main`. Confirm the `github-pages` environment URL is `https://benchb.us/`.

## How deploys relate to data collection

Collection and deployment remain separate pipelines, but a successful
collection now hands off to deployment automatically:

| Pipeline | Workflow(s) | Branch | Output |
| --- | --- | --- | --- |
| Collection | `collect-*.yml` (cron) | `bench-bus-data` | immutable validated snapshots + manifests |
| Deployment | `deploy.yml` (push to `main`, successful collector completion, or manual dispatch) | reads `bench-bus-data` | static site artifact on Pages |

`deploy.yml` checks out `main` (app source) plus `bench-bus-data` (last
known-good data, read-only), runs the derived-data compiler
(`npm run derive -- --data-dir data-branch --out-dir public/derived-data`),
builds Vite (`dist/`), verifies `dist/CNAME`, and publishes `dist/` as a
Pages artifact. Collectors never run during deploy, and deploys never write to
`bench-bus-data`.

Data freshness: the compiled bundle carries explicit per-source `observedAt`
metadata which the site displays (freshness chips + time travel), so a delayed
or missed collection cron shows up as visible staleness, never as breakage.

The collector workflows push with `GITHUB_TOKEN`, and GitHub intentionally does
not start a second workflow for that token-generated branch push. `deploy.yml`
therefore listens for the collectors' `workflow_run` completion event and only
builds for successful collector runs.

## Failure semantics

- **Broken application (typecheck, tests, or build fail):** the `build` gate
  job fails and the `deploy` job never runs. Bad code cannot deploy.
- **Failing collectors:** irrelevant to deploys by construction — collectors
  run in separate workflows on separate schedules and fail closed without
  touching the data branch. Deploys always use the newest *valid* snapshots.
- **Stale but valid data:** always deployable. If `bench-bus-data` has no
  eligible snapshots at all (e.g. first deploy before any collection), the
  derive step emits a warning and the site ships with its clearly-labelled
  demo fixture bundle instead of real data.
- **Deploy concurrency:** the `pages` concurrency group serializes deploys
  (`cancel-in-progress: false`), so overlapping pushes to `main` queue rather
  than race.
- **Rollback:** re-run `deploy.yml` from an earlier `main` commit via
  `workflow_dispatch` (choose the desired ref in the Actions UI).

## Local rehearsal

```bash
npm ci
npm run derive -- --data-dir <bench-bus-data-checkout> --out-dir public/derived-data
npm run build
ls dist/CNAME dist/derived-data/index.json   # when real data exists
npx vite preview                              # site at http://localhost:4173
```

Without a data-branch checkout, skip the derive step — the site falls back to
its labelled demo fixtures (same behavior as a deploy with an empty data
branch).
