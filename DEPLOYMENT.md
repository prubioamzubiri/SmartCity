# GitHub Pages

The production URL is https://rbarrenago.github.io/SmartCity/.
`vite.config.js` sets `/SmartCity/` as the base for assets and the existing
`CONFIG.dataUrl`, which uses Vite's `import.meta.env.BASE_URL`.

In the GitHub repository, select **Settings → Pages → Build and deployment →
Source → GitHub Actions** before deploying.

`.github/workflows/deploy.yml` runs on pushes to `main` or manual dispatch.
It installs locked dependencies with Node 24, runs `npm run fetch-osm` to
generate the ignored `public/data/city.json`, runs `npm run fetch-municipal`
to retrieve official mobility layers, builds with Vite, uploads `dist`,
and deploys the artifact to the `github-pages` environment. Generation requires
the public Overpass service; a failed download stops the build and deployment.

To reproduce locally:

```sh
npm ci
npm run fetch-osm
npm run fetch-municipal
npm run build
npm run preview
```

Open http://localhost:4173/SmartCity/. Confirm the city and traffic render and
that the browser loads JavaScript and CSS under `/SmartCity/assets/` and JSON
at `/SmartCity/data/city.json` successfully. Vite copies `public/data/city.json`
into `dist/data/city.json`; the JSON should contain nonempty buildings, nodes,
and ways arrays. An existing local dataset can be reused for previewing by
skipping `fetch-osm`.
