# Twitch Social Rating Extension

## Store builds

Chrome and Firefox store builds use the production backend URL, disable source
maps, and keep bundled JavaScript readable. The `--env store` mode intentionally
uses webpack's development resolver so third-party packages such as React are
not replaced with their minified production bundles.

```bash
npm run package:chrome
npm run package:firefox
```

Artifacts are written to:

- `web-ext-artifacts/twitch-social-rating-chrome-0.1.0.zip`
- `web-ext-artifacts/twitch-social-rating-firefox-0.1.0.zip`

The package script omits `*.map` files and uses uncompressed zip entries so the
uploaded code is easy for store reviewers and automated checks to inspect.

## Firefox AMO unlisted

AMO signing requires Mozilla API credentials:

```bash
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run amo:sign:unlisted
```

The script builds `dist-firefox` from `manifest.firefox.json` and runs:

```bash
npx web-ext sign --source-dir dist-firefox --artifacts-dir web-ext-artifacts --channel unlisted
```

AMO returns a signed `.xpi` in `web-ext-artifacts/`. Keep the Gecko extension id
in `manifest.firefox.json` stable across beta releases.
