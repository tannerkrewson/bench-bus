# Manual deployment to benchb.us

All GitHub Actions workflows **and repository Actions permissions are disabled**.
Do not enable or dispatch them. Cron triggers have also been removed locally.

Production uses GitHub Pages **Deploy from a branch**, `gh-pages`, `/`.
Builds run locally; `public/.nojekyll` bypasses GitHub's Jekyll/Actions build.
The custom domain remains `benchb.us`; HTTPS is served by Cloudflare.
**Hosting follow-up (`bench-bus-4xi`):** GitHub already reported certificate
`bad_authz` before this deploy. Switching publishing modes reset its
`https_enforced` setting, and restoring it currently fails with HTTP 404,
"The certificate has not finished being issued". HTTP does not redirect yet.
A Cloudflare administrator should enable Always Use HTTPS and repair origin
certificate issuance, then restore GitHub Pages HTTPS enforcement.
GitHub documents this Actions-free path in its
[Pages worker migration notice](https://github.blog/changelog/2024-07-08-pages-legacy-worker-sunset/).
The old `deploy.yml` artifact workflow is retained but disabled.

## Collect and validate locally

Use Node 24 LTS (`mise install`, then `mise exec node@24 -- npm …` if your
shell PATH overrides mise). Node 26's native localStorage currently conflicts
with the jsdom test environment. No dependency upgrade is required.

Create a disk-backed scratch directory and check out `origin/bench-bus-data`
there, **not over the source working tree**. Fetch before collecting and avoid
force-pushing this branch. Substitute absolute paths below:

```bash
npm ci
npm run collect:aa -- --out <scratch>/aa.json
npm run collect:openrouter -- --frontier-aa <scratch>/aa.json --out <scratch>/openrouter.json
npm run collect:cursor -- --out <scratch>/cursor.json
npm run collect:deepswe -- --out <scratch>/deepswe.json

for source in aa openrouter cursor deepswe; do
  npm run snapshot -- write --dir <data-checkout> --input <scratch>/$source.json
done
npm run derive -- --data-dir <data-checkout> --out-dir public/derived-data
npm run typecheck
npm test
node .github/scripts/validate-workflows.mjs
npm run build
```

Collectors and snapshot storage validate and fail closed. Do not publish a
failed collection or fabricate missing benchmark scores/provider prices.
AA's index generation is retained in the snapshots and the derived bundle;
the chart displays it when known. V4 scores and token workloads cannot fill
missing V5 rows. Current defaults follow relevant releases plus the complete
cheapest-provider frontier; other currently scored models remain selectable.
Historical aliases stay in the mapping for archived snapshots.

Cursor's fee policy and standard rate cards were verified October 29, 2026.
Third-party classification alone does not imply a fee: Haiku 5.5, GPT-5.6 Luna,
Gemini 3.8 Flash, GLM 5.3 Flash and other explicitly listed releases are exempt,
as are Cursor models (including Grok 4.7). The shared policy is
`src/collectors/cursor/policy.ts`; release-specific rate cards are in
`src/charts/cursor/pricing.ts`. Update both against
[Cursor's published policy](https://cursor.com/docs/models-and-pricing#cursor-token-rate),
not inferred family prefixes. Missing estimates are unavailable with the fee
enabled, never plotted as fee-free. The current default view has eight curated
families plus verified current value-frontier points (nine families / 33 effort
variants at the default fee/cache settings); other published rows remain opt-in.
A frozen 81-row fixture tests complete current pricing coverage.

DeepSWE's upstream leaderboard was last generated 2026-06-20 as of this
refresh. A fresh fetch is **not** a new evaluation; its current-model coverage
is limited. Never map its old scores to a similarly named newer release.

## Preserve history

The index must not point an old date at a newly overwritten `latest.json`.
`upsertDerivedIndexEntry` now replaces reused paths as well as reused dates.
Before overwriting a latest bundle worth keeping, compile it under a dated
name (with its original `--as-of`) or archive the original bundle and update
the index. `20260829T232939Z.json` preserves the previously deployed historical
view. Old bundles without a known index version are not labeled V5.

## Publish the validated build

1. Save the validated snapshots/manifests in a commit on `bench-bus-data` and
   push that branch normally (after checking the remote has not advanced).
2. Preview `dist/` with `npm run preview`; check desktop/mobile, model selection,
   settings, methodology, time travel, and browser errors.
3. Copy **only** `dist/` (including `.nojekyll` and `CNAME`) to an isolated
   `gh-pages` checkout. Commit the static assets there and push normally.
   Never copy `.git`, source files, credentials, or raw snapshots into it.
4. For the initial switch from artifact deployment, update Pages without
   changing the domain. Check HTTPS enforcement separately after switching:

   ```bash
   gh api -X PUT repos/{owner}/{repo}/pages --input - <<'JSON'
   {"build_type":"legacy","source":{"branch":"gh-pages","path":"/"}}
   JSON
   ```

5. Confirm `https://benchb.us/` serves the new hashed JS/CSS and
   `derived-data/latest.json` matches the local build. Inspect the live site,
   not just the preview. Verify Actions remains disabled:

   ```bash
   gh api repos/{owner}/{repo}/actions/permissions
   gh api repos/{owner}/{repo}/actions/workflows --jq '.workflows[] | [.name, .state]'
   ```

Source changes can stay uncommitted locally; publishing assets does not require
pushing `main`. Keep source/data/asset provenance in the deployment commit
message. For rollback, revert the last asset commit on `gh-pages` and push;
no Actions workflow is needed. To restore the old artifact pipeline in the
future, explicitly approve enabling Actions and switching Pages back to
`build_type: workflow` first.
