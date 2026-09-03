import type { Component } from "solid-js";
import { createResource, Show } from "solid-js";
import AaChartSection from "./charts/aa/AaChartSection";
import CursorBenchChartSection from "./charts/cursor/CursorBenchChartSection";
import { cursorBenchAdapter } from "./charts/cursor/adapter";
import { decodeBundle } from "./derived/encode";
import type { DecodedBundle } from "./derived/encode";
import { makeAaBundleFixture } from "./charts/aa/fixtures";
import { AA_CONTROL_SPECS as aaControlSpecs } from "./charts/aa/adapter";
import { chartStateFromParams, chartStateToParams } from "./charts/urlState";
import type { ChartViewState, PricingControlSpec, PricingControlState } from "./charts/types";
import type { ChartStateSerializationDefaults } from "./charts/urlState";
import { latestIsoTimestamp } from "./utils/format";
import { TimeTravelProvider, useTimeTravel } from "./history/TimeTravelContext";
import { timeTravelStateFromParams, mergeTimeTravelStateIntoParams } from "./history/urlState";
import TimeTravelControl, { TimeTravelNotice } from "./controls/TimeTravelControl";
import FeedbackCard from "./components/FeedbackCard";
import ThemeToggle from "./components/ThemeToggle";
import { driveLogo, resetLogo } from "./components/busLogo";
import {
  fetchDerivedBundle,
  fetchDerivedIndex,
  makeDemoBundle,
  makeDemoIndex,
} from "./data/derivedData";

/**
 * Home page. Both benchmark charts render through the real derived-bundle
 * decode path. When no compiled derived data is deployed yet, the loader
 * falls back to a clearly-labelled demo fixture bundle so the site works.
 */

function initialChartStateFor(
  benchmarkId: string,
  controlSpecs: readonly PricingControlSpec[],
  defaultControls: PricingControlState,
): Partial<ChartViewState> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return chartStateFromParams(params, benchmarkId, controlSpecs, {
    scale: "log",
    controls: defaultControls,
  });
}

function syncChartStateToUrl(
  state: Readonly<ChartViewState>,
  benchmarkId: string,
  serializationDefaults: Readonly<ChartStateSerializationDefaults>,
) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const key of [...params.keys()]) {
    if (key.startsWith(`chart.${benchmarkId}.`)) params.delete(key);
  }
  // The model-selector query is transient UI state, not a chart selection or
  // setting. Read legacy q values if supplied, but never re-persist them.
  for (const [key, value] of chartStateToParams(
    { ...state, query: "" },
    benchmarkId,
    serializationDefaults,
  )) {
    params.set(key, value);
  }
  const query = params.toString();
  window.history.replaceState(null, "", query === "" ? window.location.pathname : `?${query}`);
}

function initialTimeTravelSelection(): string | null | undefined {
  if (typeof window === "undefined") return undefined;
  return timeTravelStateFromParams(new URLSearchParams(window.location.search)).selectedAsOf;
}

function syncTimeTravelToUrl(state: { selectedAsOf: string | null }) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  mergeTimeTravelStateIntoParams(params, state);
  const query = params.toString();
  window.history.replaceState(null, "", query === "" ? window.location.pathname : `?${query}`);
}

/** Fetch the derived index, falling back to the demo fixture index. */
async function loadIndex() {
  try {
    return { index: await fetchDerivedIndex(), isDemo: false };
  } catch {
    return { index: makeDemoIndex(), isDemo: true };
  }
}

const Charts: Component<{ bundle: DecodedBundle }> = (props) => {
  // "Last updated" reflects the freshest source snapshot actually backing
  // each chart: AA/DeepSWE scores and optional OpenRouter pricing for the first,
  // Cursor evals for the second. Absent sources render no note rather than a fake date.
  const aaLastUpdated = () =>
    props.bundle.aa
      ? latestIsoTimestamp([
          props.bundle.sources.aa.observedAt,
          props.bundle.sources.openrouter.observedAt,
          props.bundle.sources.deepswe.observedAt,
        ])
      : null;
  const cursorLastUpdated = () =>
    props.bundle.cursor ? props.bundle.sources.cursor.observedAt ?? null : null;
  const aaUrlDefaults: ChartStateSerializationDefaults = {
    scale: "log",
    controls: { scoreSource: "aa", pricingMode: "cheapest", cacheHitRate: 0.9 },
    showLabels: true,
    showFrontier: false,
    showDiscounts: true,
  };
  const cursorUrlDefaults: ChartStateSerializationDefaults = {
    scale: "log",
    controls: { surcharge: true, cacheHitRate: 90 },
    showLabels: true,
    showFrontier: false,
    showDiscounts: true,
  };
  return (
    <div class="mt-4 space-y-8">
      <AaChartSection
        records={() => props.bundle.aa?.records ?? []}
        lastUpdated={aaLastUpdated}
        initialState={initialChartStateFor(
          "aa",
          aaControlSpecs,
          { scoreSource: "aa", pricingMode: "cheapest", cacheHitRate: 0.9 },
        )}
        onStateChange={(state) => syncChartStateToUrl(state, "aa", aaUrlDefaults)}
      />
      <CursorBenchChartSection
        records={() => props.bundle.cursor?.records ?? []}
        lastUpdated={cursorLastUpdated}
        initialState={initialChartStateFor(
          "cursor",
          cursorBenchAdapter.controlSpecs,
          { surcharge: true },
        )}
        onStateChange={(state) => syncChartStateToUrl(state, "cursor", cursorUrlDefaults)}
      />
      {!props.bundle.aa && !props.bundle.cursor ? (
        <p role="status" class="text-warning">
          No collected data at this selected time.
        </p>
      ) : null}
    </div>
  );
};

const App: Component = () => {
  const [indexResource] = createResource(loadIndex);
  const initialTime = initialTimeTravelSelection();

  // The provider needs the loaded index; render charts once it resolves.
  const Page: Component = () => {
    const timeTravel = useTimeTravel();
    const [bundleResource] = createResource(
      () => timeTravel.view().entry?.path,
      (path) => fetchDerivedBundle(path).catch(() => makeDemoBundle()),
    );
    const bundle = () =>
      bundleResource.latest ??
      decodeBundle(JSON.parse(JSON.stringify(makeAaBundleFixture())) as { cursor: null } & Record<string, unknown>);
    return (
      <main class="min-h-screen bg-base-100 text-base-content">
        <div class="bench-bus-page-shell container mx-auto flex min-h-screen max-w-7xl flex-col px-2 py-4 sm:px-6 sm:py-8">
          <header class="navbar mb-6 rounded-box bg-base-200 px-4 shadow-sm sm:px-6">
            <div class="navbar-start gap-3">
              <button
                type="button"
                class="bench-bus-logo-viewport flex h-12 w-16 shrink-0 cursor-pointer appearance-none items-center justify-center border-0 bg-transparent p-0 sm:h-14 sm:w-20"
                aria-label="Bench Bus logo"
                title="Bench Bus logo"
                onClick={driveLogo}
              >
                <span class="inline-flex h-12 w-16 shrink-0 items-center justify-center sm:h-14 sm:w-20" aria-hidden="true">
                  <img
                    class="h-12 w-16 object-contain sm:h-14 sm:w-20"
                    src="/logo.svg"
                    alt=""
                    aria-hidden="true"
                    onAnimationEnd={resetLogo}
                  />
                </span>
              </button>
              <div>
                <h1 class="text-xl font-bold tracking-tight sm:text-2xl">Bench Bus</h1>
                <p class="hidden text-xs text-base-content/70 sm:block">AI benchmark scores versus estimated benchmark workload cost.</p>
              </div>
            </div>
            <div class="navbar-end gap-2">
              <TimeTravelControl />
              <ThemeToggle />
            </div>
          </header>

          <TimeTravelNotice />
          <div class="mb-4 flex justify-end">
            <Show when={indexResource()?.isDemo}>
              <span class="badge badge-warning badge-outline">
                Demo fixture data — no collected snapshots deployed yet
              </span>
            </Show>
          </div>

          <Charts bundle={bundle()} />

          <FeedbackCard />

          <footer class="mt-6 px-4 py-4 text-center text-sm text-base-content/80">
            <div class="flex flex-col items-center justify-center gap-y-1">
              <span>
                Bench Bus by{" "}
                <a
                  class="link link-hover underline"
                  href="https://tannerkrewson.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Tanner Krewson
                </a>
              </span>
              <a
                class="link link-hover underline"
                href="https://github.com/tannerkrewson/bench-bus"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub
              </a>
            </div>
          </footer>
        </div>
      </main>
    );
  };

  const index = () => indexResource()?.index ?? makeDemoIndex();

  return (
    <TimeTravelProvider
      index={index()}
      initialSelectedAsOf={initialTime}
      onStateChange={syncTimeTravelToUrl}
    >
      {indexResource.loading ? (
        <main class="container mx-auto px-4 py-8">
          <p role="status">Loading benchmark data…</p>
        </main>
      ) : (
        <Page />
      )}
    </TimeTravelProvider>
  );
};

export default App;
