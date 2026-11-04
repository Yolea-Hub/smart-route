# Deploying the Smart Route site (smartroute.yolea.ai)

A static site (HTML, CSS, one JavaScript file) served by a Worker, `smart-route-site`, that holds files only: no server code. `smartroute.yolea.ai` is a Custom Domain of the Worker. Nothing deploys from continuous integration: deploying is a manual act, after review.

## What is in the `site/` folder

| Path | Role |
|---|---|
| `public/` | The hand-written pages: `index.html` (FR), `en/index.html` (EN), `site.css`, `site.js`, `_headers`, `404.html`, `robots.txt`, `sitemap.xml`. The legal pages (4 FR, 4 EN) are written by `scripts/gen-legal.py` |
| `kit/` | Copy of the subset of the Sogoma kit that the site loads. Written by `scripts/sync-kit.sh`, never by hand |
| `build.sh` | Assembles `dist/`: `public/` + `kit/` + the logos the pages name, with `?v=<hash>` on stylesheets and scripts |
| `dist/`, `dist.stamp` | The result, and its record (hash of the sources, commit). Not versioned |
| `deploy/wrangler.jsonc` | Worker, Custom Domain, `workers_dev: false`, `preview_urls: false` |
| `deploy/guard-fresh-build.sh` | Refuses to deploy a build that is absent, incomplete, older than its sources, or made from another commit |

## Once, before the first deploy

1. The owner's Cloudflare account, zone `yolea.ai` in that account. Wrangler sign-in: `pnpm exec wrangler login` (the owner's act).
2. The Custom Domain `smartroute.yolea.ai` creates the DNS record and the certificate by itself. No `smartroute` record may exist beforehand: otherwise the first deploy fails, delete the old record.
3. Downloads come from the public GitHub Releases of the `Yolea-Hub/smart-route` repository (no R2 bucket, no `downloads.` domain any more). Nothing to configure on the Cloudflare side: the page reads GitHub's public API and the CSP allows it (`connect-src`). The repository must be public and a release published by the `release.yml` workflow (`v*` tag); until one exists the site shows “Coming soon”.
4. Deploy dependencies: `cd site/deploy && pnpm install --ignore-workspace`.

## How the page finds the downloads

`site.js` reads `https://api.github.com/repos/Yolea-Hub/smart-route/releases/latest` (no token, no cookie). It recognises files by the names electron-builder writes (`artifactName`: `Smart-Route-<version>-<os>-<arch>.<ext>`):

| File | System |
|---|---|
| `Smart-Route-0.1.0-linux-x86_64.AppImage` | Linux, any distribution |
| `Smart-Route-0.1.0-linux-amd64.deb` | Debian, Ubuntu |
| `Smart-Route-0.1.0-win-x64.exe` | 64-bit Windows |
| `Smart-Route-0.1.0-mac-arm64.dmg`, `Smart-Route-0.1.0-mac-x64.dmg` | macOS Apple Silicon, Intel |

- The size comes from the API `size` field. The SHA-256 comes from the release's `SHA256SUMS` file, read through its `browser_download_url`; if the browser refuses (CORS), the page shows a link to `SHA256SUMS` instead.
- Only `https://github.com/Yolea-Hub/smart-route/releases/download/...` links (no query string), a name matching the pattern above and a plausible size are accepted. Drafts and prereleases are ignored.
- No release (404): “Coming soon”. API rate limit (403/429, 60 requests per hour per address): same message, with a link to the releases page.
- Behaviour check without a browser: `node --test site/tests/site-downloads.test.mjs`.
- The CSP (`public/_headers`) allows `connect-src 'self' https://api.github.com https://github.com https://objects.githubusercontent.com https://release-assets.githubusercontent.com`: the API, the `SHA256SUMS` download redirect and its host.

## Deploy

From the repository root:

```bash
# 1. Regenerate what is generated, then check
python3 -I site/scripts/gen-legal.py && python3 -I site/scripts/fr-typo.py
python3 -I tools/sogoma-check/sogoma_check.py site/public --root site
# 2. Build, guard, deploy (the repository must be clean and on the right commit)
cd site/deploy
pnpm run dry           # dry run: deploys nothing, reads the configuration
pnpm run deploy:site   # build.sh, guard-fresh-build.sh, then wrangler deploy
```

The guard refuses: an absent or incomplete `dist/`, a `robots.txt` that disallows everything, sources changed since the build, a `site/kit` that differs from `kit/`, a dirty git tree under `site/` or `assets/`, a build made from a commit other than HEAD. Wrangler runs it again by itself before any deploy (`build.command`), so a direct `wrangler deploy` is guarded too.

Check after deploying: `curl -sI https://smartroute.yolea.ai/` must show `content-security-policy`, `strict-transport-security` and `x-content-type-options`; `https://smartroute.yolea.ai/en/` and the eight legal pages answer 200; `https://smartroute.yolea.ai/missing` answers 404 with the bilingual page.

## Roll back

1. A previous version of the Worker: `cd site/deploy && pnpm run rollback` (lists the versions, pick the previous one). The Custom Domain does not move.
2. Only bad content: fix, rebuild, redeploy.
3. Take the site down: remove the `routes` entry from `wrangler.jsonc` and deploy, or delete the Custom Domain in the Cloudflare dashboard (Workers & Pages, `smart-route-site`, Settings, Domains). The DNS record the Custom Domain created goes with it.

## Updating the kit or the logos

- Kit: `bash site/scripts/sync-kit.sh` (copies from the root `kit/`, which is required: the script stops with a clear message when it is missing), then `bash site/build.sh`. `sync-kit.sh --check` says whether the copy has drifted.
- OpenAI logos: they exist (official pack, terms accepted on 4 November 2026) in `assets/brands/openai/`; see the folder's `SOURCE.md`. To change them, replace the files and check that `public/index.html` and `public/en/index.html` name them.

## Documented deviations from Sogoma

Official third-party names and logos; vendor colours (`--vc-claude`, `--vc-openai`, `--vc-google` in `site.css`) and the glow on a tool's node container, only during its turn in the diagram. See `YOLEA.md`. Expected `sogoma-check` warnings: S08 for those three colours, and for the colour in `meta theme-color`.
