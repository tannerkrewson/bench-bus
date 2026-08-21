import { For, Match, Show, Switch } from "solid-js";
import type { PricingControlSpec, PricingControlState, XScale } from "../charts/types";

export interface ChartControlPanelProps {
  scale: () => XScale;
  onScaleChange: (scale: XScale) => void;
  /** Stable benchmark namespace used to keep control IDs unique on pages with multiple charts. */
  benchmarkId: string;
  specs: readonly PricingControlSpec[];
  controls: () => Readonly<PricingControlState>;
  onControlChange: (id: string, value: number | boolean | string) => void;
  /** Optional chart display toggle, enabled by chart sections that show labels. */
  showLabels?: () => boolean;
  onShowLabelsChange?: (show: boolean) => void;
  /** Optional Pareto frontier visibility toggle. */
  showFrontier?: () => boolean;
  onShowFrontierChange?: (show: boolean) => void;
  /** Optional predicate for controls whose visibility depends on another control. */
  isControlVisible?: (spec: PricingControlSpec) => boolean;
}

/**
 * Keyboard-accessible chart controls: axis scale, display toggles, and the
 * adapter's pricing controls, rendered with DaisyUI components and
 * explicit labels.
 */
export default function ChartControlPanel(props: ChartControlPanelProps) {
  const controlId = (name: string) => `chart-${props.benchmarkId}-${name}`;

  return (
    <fieldset class="rounded-box border border-base-300 bg-base-200/40 p-4" data-testid="chart-controls">
      <legend class="px-2 text-sm font-semibold">Chart settings</legend>
      <div class="flex flex-wrap items-end gap-x-5 gap-y-4">
      <div>
        <div id={controlId("scale-group-label")} class="mb-1 text-base font-medium">
          Price axis scale
        </div>
        <div class="join" role="group" aria-labelledby={controlId("scale-group-label")}>
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

      <Show when={props.showLabels && props.onShowLabelsChange}>
        <div>
          <label class="label cursor-pointer gap-2 text-base font-medium" for={controlId("show-labels")}>
            <span>Model labels</span>
            <input
              id={controlId("show-labels")}
              type="checkbox"
              class="toggle toggle-sm toggle-primary"
              aria-label="Show model labels"
              checked={props.showLabels?.() ?? true}
              onChange={(e) => props.onShowLabelsChange?.(e.currentTarget.checked)}
            />
          </label>
        </div>
      </Show>

      <div class="flex items-center gap-2 text-base text-base-content/70" role="img" aria-label="Pareto frontier (dotted line)">
        <span class="w-6 border-t-2 border-dashed border-primary" aria-hidden="true" />
        <span>Pareto frontier</span>
      </div>

      <Show when={props.showFrontier && props.onShowFrontierChange}>
        <div>
          <label class="label cursor-pointer gap-2 text-base font-medium" for={controlId("show-frontier")}>
            <span>Pareto frontier</span>
            <input
              id={controlId("show-frontier")}
              type="checkbox"
              class="toggle toggle-sm toggle-primary"
              aria-label="Show Pareto frontier"
              checked={props.showFrontier?.() ?? true}
              onChange={(e) => props.onShowFrontierChange?.(e.currentTarget.checked)}
            />
          </label>
        </div>
      </Show>

      <For each={props.specs}>
        {(spec) => (
          <Show when={props.isControlVisible?.(spec) ?? true}>
            <Switch>
            <Match when={spec.kind === "toggle"}>
              <div>
                <label class="label cursor-pointer gap-2 text-base font-medium" for={controlId(`control-${spec.id}`)}>
                  <span>{spec.label}</span>
                  <input
                    id={controlId(`control-${spec.id}`)}
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    aria-label={spec.label}
                    checked={Boolean(props.controls()[spec.id] ?? spec.default)}
                    onChange={(e) => props.onControlChange(spec.id, e.currentTarget.checked)}
                  />
                </label>
                <Show when={spec.description}>
                  <p class="text-sm text-base-content/60">{spec.description}</p>
                </Show>
              </div>
            </Match>
            <Match when={spec.kind === "slider"}>
              <div>
                <label class="mb-1 block text-base font-medium" for={controlId(`control-${spec.id}`)}>
                  {spec.label}
                  {spec.kind === "slider" && spec.format
                    ? `: ${spec.format(Number(props.controls()[spec.id] ?? spec.default))}`
                    : ""}
                </label>
                <Show when={spec.kind === "slider"}>
                  <input
                    id={controlId(`control-${spec.id}`)}
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
                <label class="mb-1 block text-base font-medium" for={controlId(`control-${spec.id}`)}>
                  {spec.label}
                </label>
                <select
                  id={controlId(`control-${spec.id}`)}
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
