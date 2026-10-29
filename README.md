# Bench Bus

Static AI benchmark comparisons at [benchb.us](https://benchb.us): benchmark
scores versus estimated benchmark workload cost.

Bench Bus is a fully static site — no runtime server. All GitHub Actions are
disabled. Benchmark/pricing data is collected and validated locally, immutable
snapshots live on `bench-bus-data`, and locally built static assets are
published from `gh-pages` with `.nojekyll` (no Actions minutes).

## Tech stack

- [SolidJS](https://www.solidjs.com/) + TypeScript (strict)
- [Vite](https://vite.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/)
- [uPlot](https://github.com/leeoniya/uPlot) for charts
- [Vitest](https://vitest.dev/) for tests

## Development

```bash
mise install       # Node 24 LTS; Node 26 currently breaks jsdom localStorage tests
npm install
npm run dev        # dev server
npm run build      # production build -> dist/
npm run preview    # preview the production build
npm run test       # run tests once
npm run typecheck  # tsc --noEmit
```

## Deployment

Production builds target GitHub Pages at the custom domain `benchb.us`
(see `public/CNAME`). See [manual collection and deployment](docs/deployment.md)
for the local-only workflow. Do not re-enable Actions without approval.
