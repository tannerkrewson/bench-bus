# Derived chart datasets (`src/derived/`)

Build-time compilation of validated data-branch snapshots into the compact
static JSON the browser ships. Raw archival snapshots never reach the bundle.

## CLI

```sh
# Latest known-good view of every source (default name: latest.json)
npx tsx src/derived/cli.ts --data-dir <bench-bus-data-checkout> --out-dir <out>

# Historical point-in-time view (per-source latest at or before --as-of)
npx tsx src/derived/cli.ts --data-dir <dir> --out-dir <out> \
  --as-of 2026-08-15T12:00:00.000Z --name 2026-08-15
```

Outputs per invocation:

- `<out-dir>/<name>.json` — the compact bundle (see `encode.ts` for the
  documented short-key/positional-tuple encoding).
- `<out-dir>/index.json` — deterministic index of compiled views
  (`{ v, entries: [{ asOf, path, aa, cursor }] }`, sorted by `asOf`).

Exit code is nonzero and nothing is written when compilation fails
(e.g. no eligible snapshots, alias-mapping integrity violation).

## Semantics

- **Independent per-source resolution.** AA, OpenRouter, and Cursor each
  resolve to their newest valid snapshot at or before the requested time via
  `DataBranchStore.resolveSnapshot`. Mismatched observation times are
  expected; the bundle reports each source's actual `observedAt`.
- **No fabricated history.** A source with no snapshot at or before the
  requested time is marked unavailable (`0` in `sources`). The AA chart
  dataset needs an AA benchmark snapshot; OpenRouter is optional. Complete
  reasoning AA records remain in the bundle when OpenRouter has no matching
  row, with empty provider and weighted fields and their source-published
  listed prices intact. The default chart can use those listed prices until
  provider pricing arrives. The Cursor chart needs only the Cursor snapshot.
- **Past views are naturally historical.** Models absent from the historical
  AA snapshot are absent from the compiled view, and pricing comes from the
  snapshot known at that time.
- **Mapping integrity.** The AA↔OpenRouter join is validated against the
  explicit alias file (`src/collectors/openrouter/openrouter-aliases.json`):
  an OpenRouter record whose `aaModelSlug` is not in the mapping fails the
  build. Provisional aliases compile but are counted in the run stats.

## Size tradeoff

AA records keep the FULL per-provider effective-price lists rather than a
precomputed cheapest-provider cost. Rationale: cheapest-single-provider cost
depends on the canonical benchmark token workload, which the chart layer
already has per model; shipping raw provider prices lets the browser recompute
every pricing mode (cheapest/weighted/listed-with-cache-slider) from one
payload and survives pricing-mode changes without a data rebuild. Payload size
is kept in check by the positional-tuple encoding (see `encode.ts`); the test
suite asserts the derived bundle is substantially smaller than the raw
snapshots it was compiled from, and that raw-only fields (release dates,
cache-write prices, answer/reasoning token splits, permaslugs) never ship.

## Determinism

Identical data-branch contents and options produce byte-identical output
(fixed key order, no indentation, sorted records/entries, no wall-clock
timestamps in output). Verified by tests.
