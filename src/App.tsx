import type { Component } from "solid-js";
import BenchmarkChartSection from "./components/BenchmarkChartSection";
import { AA_FIXTURE_RECORDS, CURSOR_FIXTURE_RECORDS, aaDemoAdapter, cursorDemoAdapter } from "./charts/fixtures";
import { chartStateFromParams, chartStateToParams } from "./charts/urlState";
import type { ChartViewState, PricingControlSpec, PricingControlState } from "./charts/types";

/**
 * Home page. The real data-driven charts land with the AA/Cursor chart
 * issues; this demo proves the generic chart system end to end with
 * fixture datasets shaped like both benchmarks, including URL state sync.
 */

function initialStateFor(
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

function syncStateToUrl(state: Readonly<ChartViewState>, benchmarkId: string) {
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

const App: Component = () => {
  return (
    <main class="container mx-auto px-4 py-8">
      <div class="hero bg-base-200 rounded-box">
        <div class="hero-content text-center">
          <div class="max-w-md">
            <h1 class="text-5xl font-bold">Bench Bus</h1>
            <p class="py-6">
              AI benchmark scores versus estimated benchmark workload cost.
            </p>
          </div>
        </div>
      </div>

      <p class="mt-8 text-sm text-base-content/60">
        Demo charts below use fixture data to prove the generic chart system; real benchmark
        datasets arrive with the data-collection issues.
      </p>

      <div class="mt-4 space-y-8">
        <BenchmarkChartSection
          adapter={aaDemoAdapter}
          records={() => AA_FIXTURE_RECORDS}
          initialState={initialStateFor(
            aaDemoAdapter.benchmarkId,
            aaDemoAdapter.controlSpecs,
            { pricingMode: "cheapest", cacheHitRate: 0.9 },
          )}
          onStateChange={(state) => syncStateToUrl(state, aaDemoAdapter.benchmarkId)}
        />
        <BenchmarkChartSection
          adapter={cursorDemoAdapter}
          records={() => CURSOR_FIXTURE_RECORDS}
          initialState={initialStateFor(cursorDemoAdapter.benchmarkId, cursorDemoAdapter.controlSpecs, {
            surcharge: false,
          })}
          onStateChange={(state) => syncStateToUrl(state, cursorDemoAdapter.benchmarkId)}
        />
      </div>
    </main>
  );
};

export default App;
