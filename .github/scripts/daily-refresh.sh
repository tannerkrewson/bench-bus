#!/usr/bin/env bash
# Collect every source, store the snapshots, rebuild the site, and publish it.
#
# Usage: daily-refresh.sh <bench-bus-data checkout> <gh-pages checkout>
#
# A source that fails keeps its last-known-good snapshot: the others still
# publish, and the run exits nonzero afterwards so the failure stays visible.
set -euo pipefail

data_dir=$1
site_dir=$2
source_sha=$(git rev-parse HEAD)
work_dir=$(mktemp -d)
failed=()

configure_git() {
  git -C "$1" config user.name "github-actions[bot]"
  git -C "$1" config user.email "github-actions[bot]@users.noreply.github.com"
}
configure_git "$data_dir"
configure_git "$site_dir"

collect() {
  local source=$1
  shift
  local envelope="$work_dir/$source.json"
  if npm run -s "collect:$source" -- --out "$envelope" "$@" &&
    npm run -s snapshot -- write --dir "$data_dir" --input "$envelope"; then
    return 0
  fi
  echo "::error::$source collection failed; keeping its last-known-good snapshot"
  rm -f "$envelope"
  failed+=("$source")
}

collect aa
# The frontier lookup prefers today's AA data and falls back to the newest stored.
frontier_aa="$work_dir/aa.json"
[[ -f "$frontier_aa" ]] || frontier_aa=$(find "$data_dir/snapshots/aa" -type f -name '*.json' | sort | tail -n 1)
collect openrouter --frontier-aa "$frontier_aa"
collect cursor

if [[ ${#failed[@]} -eq 3 ]]; then
  echo "::error::every collector failed; nothing to publish"
  exit 1
fi

npm run -s snapshot -- commit --repo "$data_dir" --message "collect: daily refresh $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git -C "$data_dir" pull --rebase --quiet origin bench-bus-data
git -C "$data_dir" push --quiet origin HEAD:bench-bus-data

# Tests only depend on the source, so skip them when it hasn't changed since the
# last publish. Data is already validated by the snapshot store and compiler.
published_sha=$(git -C "$site_dir" log -1 --format=%B | sed -n 's/^Source: //p')
if [[ "$published_sha" == "$source_sha" ]]; then
  echo "Source unchanged since the last publish; skipping typecheck and tests."
else
  npm run -s typecheck
  npm test
fi

# The published index lists the time-travel history, because this job never
# commits to main. Every listed view is rebuilt from the data branch with this
# source, so a change to the derived format never strands an older bundle.
# public/derived-data is generated, not tracked, so a fresh checkout lacks it.
rm -rf public/derived-data
mkdir -p public/derived-data
published_index="$site_dir/derived-data/index.json"
[[ -f "$published_index" ]] || published_index=/dev/null

# Keep a weekly point in the history: an outgoing latest.json becomes a dated
# view once it is a week newer than the last one. Any other latest.json is
# simply replaced, which keeps the site from growing by a bundle a day. Only
# asOf and path are read, so this works across index format versions.
history=$(node -e '
  const raw = require("node:fs").readFileSync(process.argv[1], "utf8").trim();
  const entries = raw ? JSON.parse(raw).entries : [];
  const dated = entries.filter((entry) => entry.path !== "latest.json").map((entry) => entry.asOf);
  const latest = entries.find((entry) => entry.path === "latest.json");
  const week = 7 * 24 * 60 * 60 * 1000;
  const newestDated = Math.max(0, ...dated.map((asOf) => Date.parse(asOf)));
  if (latest && Date.parse(latest.asOf) - newestDated >= week) dated.push(latest.asOf);
  console.log(dated.join("\n"));
' "$published_index")
mapfile -t history_as_of <<<"$history"
for as_of in "${history_as_of[@]}"; do
  [[ -n "$as_of" ]] || continue
  name=$(sed -E 's/[-:]//g; s/\.[0-9]+//' <<<"$as_of")
  npm run -s derive -- --data-dir "$data_dir" --out-dir public/derived-data --as-of "$as_of" --name "$name"
done
npm run -s derive -- --data-dir "$data_dir" --out-dir public/derived-data
# The native bundler has segfaulted intermittently; a clean rebuild succeeds.
npm run -s build || npm run -s build

# Pages needs both files at the root to keep serving benchb.us without Jekyll.
[[ "$(tr -d '[:space:]' <dist/CNAME)" == "benchb.us" ]]
[[ -f dist/.nojekyll ]]

find "$site_dir" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a dist/. "$site_dir/"
git -C "$site_dir" add -A
if git -C "$site_dir" diff --cached --quiet; then
  echo "Published site is already up to date."
else
  git -C "$site_dir" commit --quiet -m "deploy: daily refresh $(date -u +%Y-%m-%d)" -m "Source: $source_sha"
  git -C "$site_dir" push --quiet origin HEAD:gh-pages
  # A push made with the Actions token may not start a Pages build by itself.
  gh api -X POST "repos/$GITHUB_REPOSITORY/pages/builds" --silent ||
    echo "::warning::could not request a Pages build"
fi

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "::error::published without fresh data from: ${failed[*]}"
  exit 1
fi
