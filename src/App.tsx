import type { Component } from "solid-js";
import { createResource } from "solid-js";
import AaChartSection from "./charts/aa/AaChartSection";
import CursorBenchChartSection from "./charts/cursor/CursorBenchChartSection";
import { cursorBenchAdapter } from "./charts/cursor/adapter";
import { decodeBundle } from "./derived/encode";
import type { DecodedBundle } from "./derived/encode";
import { makeAaBundleFixture } from "./charts/aa/fixtures";
import { AA_CONTROL_SPECS as aaControlSpecs } from "./charts/aa/adapter";
import { chartStateFromParams, chartStateToParams } from "./charts/urlState";
import type { ChartViewState, PricingControlSpec, PricingControlState } from "./charts/types";
import { TimeTravelProvider, useTimeTravel } from "./history/TimeTravelContext";
import { timeTravelStateFromParams, mergeTimeTravelStateIntoParams } from "./history/urlState";
import TimeTravelControl from "./controls/TimeTravelControl";
import AaMethodologyPanel from "./methodology/AaMethodologyPanel";
import CursorMethodologyPanel from "./methodology/CursorMethodologyPanel";
import ThemeToggle from "./components/ThemeToggle";
import { UnifiedLimitationsPanel } from "./methodology/MethodologyPanel";
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

function syncChartStateToUrl(state: Readonly<ChartViewState>, benchmarkId: string) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  for (const key of [...params.keys()]) {
    if (key.startsWith(`chart.${benchmarkId}.`)) params.delete(key);
  }
  for (const [key, value] of chartStateToParams(state, benchmarkId)) {
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
  const timeTravel = useTimeTravel();
  return (
    <div class="mt-4 space-y-8">
      <AaChartSection
        records={() => props.bundle.aa?.records ?? []}
        initialState={initialChartStateFor(
          "aa",
          aaControlSpecs,
          { pricingMode: "cheapest", cacheHitRate: 0.9 },
        )}
        onStateChange={(state) => syncChartStateToUrl(state, "aa")}
      />
      <AaMethodologyPanel />
      <CursorBenchChartSection
        records={() => props.bundle.cursor?.records ?? []}
        initialState={initialChartStateFor(
          "cursor",
          cursorBenchAdapter.controlSpecs,
          { surcharge: false },
        )}
        onStateChange={(state) => syncChartStateToUrl(state, "cursor")}
      />
      <CursorMethodologyPanel />
      <UnifiedLimitationsPanel />
      {timeTravel.view().preHistory || (!props.bundle.aa && !props.bundle.cursor) ? (
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
        <div class="container mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-8">
          <header class="navbar mb-6 rounded-box bg-base-200 px-4 shadow-sm sm:px-6">
            <div class="navbar-start gap-3">
              <img class="h-12 w-16 object-contain sm:h-14 sm:w-20" src="/logo.svg" alt="Bench Bus logo" />
              <div>
                <h1 class="text-xl font-bold tracking-tight sm:text-2xl">Bench Bus</h1>
                <p class="hidden text-xs text-base-content/70 sm:block">AI benchmark scores versus estimated benchmark workload cost.</p>
              </div>
            </div>
            <div class="navbar-end">
              <ThemeToggle />
            </div>
          </header>

          <div class="flex flex-wrap items-center justify-between gap-4">
            <TimeTravelControl />
            {indexResource()?.isDemo ? (
              <span class="badge badge-warning badge-outline">
                Demo fixture data — no collected snapshots deployed yet
              </span>
            ) : null}
          </div>

          <Charts bundle={bundle()} />

          <footer class="footer footer-center mt-12 border-t border-base-300 bg-base-200/60 px-4 py-8 text-sm">
            <p>
              Bench Bus by{" "}
              <a
                class="link link-hover font-semibold"
                href="https://tannerkrewson.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Tanner Krewson
              </a>
            </p>
            <p>
              <a
                class="link link-hover"
                href="https://github.com/tannerkrewson/bench-bus"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub
              </a>
            </p>
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
