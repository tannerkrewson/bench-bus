import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js";
import { Settings } from "lucide-solid";
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
  /** Optional Pareto frontier-line visibility toggle. */
  showFrontier?: () => boolean;
  onShowFrontierChange?: (show: boolean) => void;
  /** Optional Pareto crown visibility toggle, enabled by default. */
  showCrowns?: () => boolean;
  onShowCrownsChange?: (show: boolean) => void;
  /** Optional source-backed discount visibility toggle. */
  showDiscounts?: () => boolean;
  onShowDiscountsChange?: (show: boolean) => void;
  /** Optional predicate for controls whose visibility depends on another control. */
  isControlVisible?: (spec: PricingControlSpec) => boolean;
}

/**
 * Keyboard-accessible chart controls. The settings button follows the same
 * native-details interaction pattern as the model selector, keeping controls
 * close to their graph without taking space from the chart.
 */
export default function ChartControlPanel(props: ChartControlPanelProps) {
  let details: HTMLDetailsElement | undefined;
  let summary: HTMLElement | undefined;
  let panel: HTMLFieldSetElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [sliderActive, setSliderActive] = createSignal(false);
  const controlId = (name: string) => `chart-${props.benchmarkId}-${name}`;

  const close = (restoreFocus = false) => {
    setSliderActive(false);
    setOpen(false);
    if (details) details.open = false;
    if (restoreFocus) summary?.focus();
  };

  const focusFirstControl = () => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      panel?.querySelector<HTMLElement>("button, input, select")?.focus();
    });
  };

  onMount(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (details && !details.contains(event.target as Node)) close();
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open()) {
        event.preventDefault();
        close(true);
      }
    };
    const onSliderInteractionEnd = () => setSliderActive(false);
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeyDown);
    // The pointer can leave the range input while a drag is in progress. Keep
    // the cleanup on the document so mouse, touch, and pointer cancellation
    // always restore the popup, including when the pointer ends outside it.
    document.addEventListener("pointerup", onSliderInteractionEnd);
    document.addEventListener("pointercancel", onSliderInteractionEnd);
    document.addEventListener("mouseup", onSliderInteractionEnd);
    document.addEventListener("touchend", onSliderInteractionEnd);
    document.addEventListener("touchcancel", onSliderInteractionEnd);
    document.addEventListener("cancel", onSliderInteractionEnd);
    onCleanup(() => {
      setSliderActive(false);
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeyDown);
      document.removeEventListener("pointerup", onSliderInteractionEnd);
      document.removeEventListener("pointercancel", onSliderInteractionEnd);
      document.removeEventListener("mouseup", onSliderInteractionEnd);
      document.removeEventListener("touchend", onSliderInteractionEnd);
      document.removeEventListener("touchcancel", onSliderInteractionEnd);
      document.removeEventListener("cancel", onSliderInteractionEnd);
    });
  });

  return (
    <details
      ref={details}
      class="dropdown dropdown-end relative mb-3 flex justify-end"
      open={open()}
      onToggle={(event) => {
        const nextOpen = (event.currentTarget as HTMLDetailsElement).open;
        setOpen(nextOpen);
        if (nextOpen) focusFirstControl();
      }}
      data-testid="chart-settings"
    >
      <summary
        ref={summary}
        class="btn btn-outline btn-sm list-none gap-2"
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-controls={controlId("panel")}
        aria-label="Chart settings"
        onClick={(event) => {
          // Keep one disclosure control while making the native details
          // interaction deterministic across browsers and jsdom.
          event.preventDefault();
          const nextOpen = !open();
          setOpen(nextOpen);
          if (details) details.open = nextOpen;
          if (nextOpen) focusFirstControl();
        }}
      >
        <Settings size={16} stroke-width={2.5} aria-hidden="true" />
        <span>Settings</span>
      </summary>
      <div
        class="dropdown-content absolute right-0 top-full z-20 mt-2 w-[min(42rem,calc(100vw-2rem))] max-w-full"
        data-testid="chart-settings-popup"
        role="dialog"
        aria-label="Chart settings"
      >
        <fieldset
          ref={panel}
          id={controlId("panel")}
          class="rounded-box border border-base-300 bg-base-200/95 p-4 shadow-xl"
          style={{ opacity: sliderActive() ? 0.2 : 1, transition: "opacity 100ms ease" }}
          data-testid="chart-controls"
        >
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

            <Show when={props.showFrontier && props.onShowFrontierChange}>
              <div>
                <label class="label cursor-pointer gap-2 text-base font-medium" for={controlId("show-frontier")}>
                  <span>Pareto frontier</span>
                  <input
                    id={controlId("show-frontier")}
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    aria-label="Show Pareto frontier"
                    checked={props.showFrontier?.() ?? false}
                    onChange={(e) => props.onShowFrontierChange?.(e.currentTarget.checked)}
                  />
                </label>
              </div>
            </Show>

            <Show when={props.showCrowns && props.onShowCrownsChange}>
              <div>
                <label class="label cursor-pointer gap-2 text-base font-medium" for={controlId("show-crowns")}>
                  <span>Pareto crowns</span>
                  <input
                    id={controlId("show-crowns")}
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    aria-label="Show Pareto crowns"
                    checked={props.showCrowns?.() ?? true}
                    onChange={(e) => props.onShowCrownsChange?.(e.currentTarget.checked)}
                  />
                </label>
              </div>
            </Show>

            <Show when={props.showDiscounts && props.onShowDiscountsChange}>
              <div>
                <label class="label cursor-pointer gap-2 text-base font-medium" for={controlId("show-discounts")}>
                  <span>Provider discounts</span>
                  <input
                    id={controlId("show-discounts")}
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    aria-label="Show provider discounts"
                    checked={props.showDiscounts?.() ?? true}
                    onChange={(e) => props.onShowDiscountsChange?.(e.currentTarget.checked)}
                  />
                </label>
              </div>
            </Show>

            {/* The visible frontier legend lives below each graph. Keep this
                short screen-reader description with the related toggle. */}
            <Show when={props.showFrontier?.() ?? false}>
              <span class="sr-only" role="img" aria-label="Pareto frontier (dotted line)">Pareto frontier (dotted line)</span>
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
                        <input
                          id={controlId(`control-${spec.id}`)}
                          type="range"
                          class="range range-sm range-primary w-48"
                          min={spec.kind === "slider" ? spec.min : 0}
                          max={spec.kind === "slider" ? spec.max : 100}
                          step={spec.kind === "slider" ? spec.step : 1}
                          value={Number(props.controls()[spec.id] ?? spec.default)}
                          aria-label={spec.label}
                          onPointerDown={() => setSliderActive(true)}
                          onPointerUp={() => setSliderActive(false)}
                          onPointerCancel={() => setSliderActive(false)}
                          onMouseDown={() => setSliderActive(true)}
                          onMouseUp={() => setSliderActive(false)}
                          onTouchStart={() => setSliderActive(true)}
                          onTouchEnd={() => setSliderActive(false)}
                          onTouchCancel={() => setSliderActive(false)}
                          onCancel={() => setSliderActive(false)}
                          onInput={(e) => props.onControlChange(spec.id, e.currentTarget.valueAsNumber)}
                        />
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
      </div>
    </details>
  );
}
