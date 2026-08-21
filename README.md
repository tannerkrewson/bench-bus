# Bench Bus

Static AI benchmark comparisons at [benchb.us](https://benchb.us): benchmark
scores versus estimated benchmark workload cost.

Bench Bus is a fully static site — no runtime server. GitHub Actions collects
and validates upstream benchmark/pricing data on a schedule, preserves
timestamped snapshots on a dedicated data branch, and the site is built with
Vite and deployed to GitHub Pages from a build artifact.

## Tech stack

- [SolidJS](https://www.solidjs.com/) + TypeScript (strict)
- [Vite](https://vite.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/)
- [uPlot](https://github.com/leeoniya/uPlot) for charts
- [Vitest](https://vitest.dev/) for tests

## Development

```bash
npm install
npm run dev        # dev server
npm run build      # production build -> dist/
npm run preview    # preview the production build
npm run test       # run tests once
npm run typecheck  # tsc --noEmit
```

## Deployment

Production builds target GitHub Pages at the custom domain `benchb.us`
(see `public/CNAME`). Deployment uses the GitHub Actions artifact flow —
no `gh-pages` branch is used for compiled output.
