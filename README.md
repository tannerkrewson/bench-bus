# Bench Bus

Static AI benchmark comparisons at [benchb.us](https://benchb.us): benchmark
scores versus estimated benchmark workload cost.

Bench Bus is a fully static site — no runtime server. One GitHub Actions job
runs daily at 5:07 PM Eastern: it collects and validates benchmark/pricing data,
stores immutable snapshots on `bench-bus-data`, and publishes the built static
assets to `gh-pages` with `.nojekyll`.

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
(see `public/CNAME`). See [collection and deployment](docs/deployment.md) for
the daily job and the manual fallback.
