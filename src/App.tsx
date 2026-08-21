import type { Component } from "solid-js";
import Sparkline from "./charts/Sparkline";

/**
 * Placeholder home page proving SolidJS + DaisyUI + uPlot are wired together.
 * The real benchmark charts, controls, and data loading are added by later issues.
 */
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

      <section class="card bg-base-100 border-base-300 mt-8 border shadow-sm">
        <div class="card-body">
          <h2 class="card-title">Scaffold check: uPlot sparkline</h2>
          <Sparkline values={[1, 3, 2, 5, 4, 7, 6, 9]} />
        </div>
      </section>
    </main>
  );
};

export default App;
