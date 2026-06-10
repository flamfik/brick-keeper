# Brick Keeper

Brick Keeper is a fast, dependency-free browser organizer for a LEGO brick
collection. It runs entirely in the browser and supports Polish, English and
Spanish.

> LEGO is a trademark of the LEGO Group, which does not sponsor, authorize or
> endorse this project.

## Features

- collection dashboard with totals for parts, pieces and colors;
- instant search, category/color filters and sorting;
- adding, editing, deleting and quickly counting parts;
- optional part photos, resized and compressed locally before saving;
- part-number lookup backed by an optimized CSV-derived reference catalog;
- 273 official colors generated from `BrickKeeper_DB/colors.csv`;
- automatic duplicate merging by part number and color;
- installable PWA with an offline application shell;
- import and export using a documented JSON format;
- optional direct reading and automatic saving to a connected JSON file;
- local fallback persistence when no file is connected;
- Polish, English and Spanish interface;
- responsive, keyboard-friendly interface with no runtime dependencies.

## Run locally

ES modules and `fetch()` require an HTTP server. With Node.js 20+ run:

```bash
node tools/server.mjs
```

Then open <http://localhost:8080>.

Any static server works as well, for example:

```bash
python -m http.server 8080
```

## Project structure

```text
.
├── data/
│   └── bricks.json       # starter inventory and JSON format example
├── docs/
│   └── ARCHITECTURE.md   # technical architecture and extension guide
├── js/
│   ├── app.js            # state, rendering and user interaction
│   ├── file-storage.js   # connected JSON file and remembered permissions
│   ├── i18n.js           # translations and interpolation
│   ├── inventory.js      # duplicate identity and merge rules
│   └── storage.js        # persistence, validation, import/export
├── tools/
│   └── server.mjs        # optional zero-dependency development server
├── manifest.webmanifest  # installable PWA metadata
├── service-worker.js     # offline application-shell cache
├── index.html            # semantic application shell and templates
└── styles.css            # responsive visual system
```

## Data storage

`data/bricks.json` provides the initial collection. Use **Connect file** to open
an existing Brick Keeper JSON document. Once connected, every collection change
is written directly to that file. The file handle is remembered in IndexedDB;
after restarting the browser, a single click may be required to renew access.

When no file is connected, the app keeps a fallback copy in `localStorage`.
This fallback is tied to the exact site address, so `localhost`, GitHub Pages
and a directly opened `file://` page do not share the same collection.

Use **Export** to create the first JSON file, then connect the downloaded file.
Direct file access requires a Chromium-based browser such as Chrome or Edge and
a secure origin such as HTTPS or `http://localhost`.

Photos are stored as compressed WebP data URLs in the item's optional `image`
field. This keeps exported JSON self-contained. Browser storage is limited, so
large photo collections should be exported regularly.

## Reference catalog

The add/edit form searches an optimized catalog generated from
`BrickKeeper_DB/parts.csv` and `part_categories.csv`. The browser fetches only
the shard matching the first three characters of a part number, so the full
catalog is never loaded at startup and individual requests remain small.

To rebuild the catalog after replacing the source CSV files:

```bash
node tools/build-catalog.mjs path/to/BrickKeeper_DB data/catalog
```

On Windows, the equivalent PowerShell command is:

```powershell
.\tools\build-catalog.ps1 path\to\BrickKeeper_DB data\catalog
```

The generated catalog is read-only reference data. The user's quantities,
locations, notes and photos remain in the versioned collection JSON.

The color selector is generated from `BrickKeeper_DB/colors.csv`:

```bash
node tools/build-colors.mjs path/to/BrickKeeper_DB/colors.csv data/colors.json
```

PWA icons can be regenerated without external packages:

```bash
node tools/build-icons.mjs icons
```

Legacy color keys from earlier Brick Keeper releases are resolved to their
official IDs automatically. New records store the stable CSV color ID.

Browsers can overwrite only a file explicitly selected by the user. The File
System Access API permission keeps this compatible with static GitHub Pages
hosting without giving the site unrestricted disk access.

## Deploy to GitHub Pages

1. Create a GitHub repository and push this directory.
2. Open **Settings → Pages** in the repository.
3. Select **Deploy from a branch**, branch `main`, directory `/ (root)`.
4. Save. GitHub will publish the static application.

No build command or environment variables are required.

## Offline installation

Brick Keeper includes a web app manifest and service worker. In Chrome or Edge,
use the browser's **Install app** action to run it in a standalone window. The
application shell, starter data and color catalog work offline. Part catalog
shards become available offline after they have been opened once.

## JSON format

The root object must contain `schemaVersion: 1` and an `items` array. Required
item fields are `id`, `name`, `partNumber`, `category`, `color` and a
non-negative integer `quantity`. See [`data/bricks.json`](data/bricks.json) for a
complete example.

## Performance

- no framework, package manager or production build step;
- one CSS file and three small ES modules;
- delegated events for all inventory cards;
- card creation in a `DocumentFragment` followed by one DOM update;
- derived filtering without duplicating application state;
- CSS `contain` on cards to limit layout and paint work;
- system fonts, inline SVG icons and no external network requests.
- GitHub Actions syntax and starter-data validation on every pull request.
- service-worker application-shell caching for repeat and offline visits.

For very large collections (several thousand visible cards), list
virtualization is the next appropriate optimization.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
