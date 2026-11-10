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
collect deepswe

if [[ ${#failed[@]} -eq 4 ]]; then
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

# The published index owns history, because this job never commits to main.
# public/derived-data is generated, not tracked, so a fresh checkout lacks it.
mkdir -p public/derived-data
if [[ -f "$site_dir/derived-data/index.json" ]]; then
  cp -f "$site_dir"/derived-data/*.json public/derived-data/
fi

# Keep a weekly point in the time-travel history. Any other outgoing latest.json
# is simply replaced, which keeps the published site from growing by a bundle a day.
archive_as_of=$(node -e '
  const { entries } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  const latest = entries.find((entry) => entry.path === "latest.json");
  const dated = entries.filter((entry) => entry.path !== "latest.json").map((entry) => Date.parse(entry.asOf));
  const week = 7 * 24 * 60 * 60 * 1000;
  if (latest && Date.parse(latest.asOf) - Math.max(0, ...dated) >= week) console.log(latest.asOf);
' public/derived-data/index.json)
if [[ -n "$archive_as_of" ]]; then
  archive_name=$(sed -E 's/[-:]//g; s/\.[0-9]+//' <<<"$archive_as_of")
  npm run -s derive -- --data-dir "$data_dir" --out-dir public/derived-data --as-of "$archive_as_of" --name "$archive_name"
fi
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
