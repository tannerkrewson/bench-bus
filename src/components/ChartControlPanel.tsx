import { For, Match, Show, Switch } from "solid-js";
import type { PricingControlSpec, PricingControlState, XScale } from "../charts/types";

export interface ChartControlPanelProps {
  scale: () => XScale;
  onScaleChange: (scale: XScale) => void;
  query: () => string;
  onQueryChange: (query: string) => void;
  specs: readonly PricingControlSpec[];
  controls: () => Readonly<PricingControlState>;
  onControlChange: (id: string, value: number | boolean | string) => void;
  /** Optional chart display toggle, enabled by chart sections that show labels. */
  showLabels?: () => boolean;
  onShowLabelsChange?: (show: boolean) => void;
  /** Optional predicate for controls whose visibility depends on another control. */
  isControlVisible?: (spec: PricingControlSpec) => boolean;
}

/**
 * Keyboard-accessible chart controls: axis scale toggle, search filter, and
 * the adapter's pricing controls, rendered with DaisyUI components and
 * explicit labels.
 */
export default function ChartControlPanel(props: ChartControlPanelProps) {
  return (
    <fieldset class="rounded-box border border-base-300 bg-base-200/40 p-4" data-testid="chart-controls">
      <legend class="px-2 text-sm font-semibold">Chart settings</legend>
      <div class="flex flex-wrap items-end gap-x-5 gap-y-4">
      <div>
        <div id="chart-scale-group-label" class="mb-1 text-sm font-medium">
          Price axis scale
        </div>
        <div class="join" role="group" aria-labelledby="chart-scale-group-label">
          <button
            type="button"
            class="btn btn-sm join-item"
            classList={{
              "btn-primary": props.scale() === "log",
              "btn-outline": props.scale() !== "log",
            }}
            aria-pressed={props.scale() === "log"}
            onClick={() => props.onScaleChange("log")}
          >
            Log
          </button>
          <button
            type="button"
            class="btn btn-sm join-item"
            classList={{
              "btn-primary": props.scale() === "linear",
              "btn-outline": props.scale() !== "linear",
            }}
            aria-pressed={props.scale() === "linear"}
            onClick={() => props.onScaleChange("linear")}
          >
            Linear
          </button>
        </div>
      </div>

      <div>
        <label class="mb-1 block text-sm font-medium" for="benchmark-chart-search">
          Filter models
        </label>
        <input
          id="benchmark-chart-search"
          type="search"
          class="input input-sm input-bordered w-56"
          placeholder="Search by name…"
          value={props.query()}
          aria-label="Filter models by name"
          onInput={(e) => props.onQueryChange(e.currentTarget.value)}
        />
      </div>

      <Show when={props.showLabels && props.onShowLabelsChange}>
        <div>
          <label class="label cursor-pointer gap-2 text-sm font-medium" for="chart-control-showLabels">
            <span>Model labels</span>
            <input
              id="chart-control-showLabels"
              type="checkbox"
              class="toggle toggle-sm toggle-primary"
              aria-label="Show model labels"
              checked={props.showLabels?.() ?? true}
              onChange={(e) => props.onShowLabelsChange?.(e.currentTarget.checked)}
            />
          </label>
        </div>
      </Show>

      <div class="flex items-center gap-2 text-sm text-base-content/70" aria-label="Pareto frontier (dotted line)">
        <span class="w-6 border-t-2 border-dashed border-primary" aria-hidden="true" />
        <span>Pareto frontier</span>
      </div>

      <For each={props.specs}>
        {(spec) => (
          <Show when={props.isControlVisible?.(spec) ?? true}>
            <Switch>
            <Match when={spec.kind === "toggle"}>
              <div>
                <label class="label cursor-pointer gap-2 text-sm font-medium">
                  <span>{spec.label}</span>
                  <input
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    aria-label={spec.label}
                    checked={Boolean(props.controls()[spec.id] ?? spec.default)}
                    onChange={(e) => props.onControlChange(spec.id, e.currentTarget.checked)}
                  />
                </label>
                <Show when={spec.description}>
                  <p class="text-xs text-base-content/60">{spec.description}</p>
                </Show>
              </div>
            </Match>
            <Match when={spec.kind === "slider"}>
              <div>
                <label class="mb-1 block text-sm font-medium" for={`chart-control-${spec.id}`}>
                  {spec.label}
                  {spec.kind === "slider" && spec.format
                    ? `: ${spec.format(Number(props.controls()[spec.id] ?? spec.default))}`
                    : ""}
                </label>
                <Show when={spec.kind === "slider"}>
                  <input
                    id={`chart-control-${spec.id}`}
                    type="range"
                    class="range range-sm range-primary w-48"
                    min={spec.kind === "slider" ? spec.min : 0}
                    max={spec.kind === "slider" ? spec.max : 100}
                    step={spec.kind === "slider" ? spec.step : 1}
                    value={Number(props.controls()[spec.id] ?? spec.default)}
                    aria-label={spec.label}
                    onInput={(e) => props.onControlChange(spec.id, e.currentTarget.valueAsNumber)}
                  />
                </Show>
                <Show when={spec.description}>
                  <p class="mt-1 text-xs text-base-content/60">{spec.description}</p>
                </Show>
              </div>
            </Match>
            <Match when={spec.kind === "select"}>
              <div>
                <label class="mb-1 block text-sm font-medium" for={`chart-control-${spec.id}`}>
                  {spec.label}
                </label>
                <select
                  id={`chart-control-${spec.id}`}
                  class="select select-sm select-bordered"
                  aria-label={spec.label}
                  value={String(props.controls()[spec.id] ?? spec.default)}
                  onChange={(e) => props.onControlChange(spec.id, e.currentTarget.value)}
                >
                  <For each={spec.kind === "select" ? spec.options : []}>
                    {(opt) => <option value={opt.value}>{opt.label}</option>}
                  </For>
                </select>
                <Show when={spec.description}>
                  <p class="mt-1 text-xs text-base-content/60">{spec.description}</p>
                </Show>
              </div>
            </Match>
            </Switch>
          </Show>
        )}
      </For>
      </div>
    </fieldset>
  );
}
