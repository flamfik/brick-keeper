# Brick Keeper v1.0b

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
- automatic catalog photos selected by part number and color;
- part-number lookup backed by an optimized CSV-derived reference catalog;
- set search with owned/missing-part comparison;
- barcode and QR scanning where the browser supports `BarcodeDetector`;
- twenty local IndexedDB snapshots with one-click undo and restore;
- automatic migration of older collection files to schema version 2;
- persistent-storage requests to reduce automatic browser eviction risk;
- incremental card rendering for large filtered collections;
- 273 official colors generated from `BrickKeeper_DB/colors.csv`;
- automatic duplicate merging by part number and color;
- installable PWA with an offline application shell;
- an in-app prompt when a new PWA version is ready;
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
The app also requests persistent browser storage where supported. The browser
may still deny that request, so JSON export or a connected file remains the
recommended long-term backup.

Use **Export** to create the first JSON file, then connect the downloaded file.
Direct file access requires a Chromium-based browser such as Chrome or Edge and
a secure origin such as HTTPS or `http://localhost`.

Browsers without the File System Access API can still use the regular Import and
Export actions. Scanning also falls back to manual entry when `BarcodeDetector`
or camera access is unavailable.

Photos are stored as compressed WebP data URLs in the item's optional `image`
field. This keeps exported JSON self-contained. Browser storage is limited, so
large photo collections should be exported regularly.

Automatically selected catalog photos are stored as HTTPS references in
`catalogImage` and loaded from Rebrickable's CDN. A user-uploaded photo takes
priority and remains embedded in the JSON.

## Reference catalog

The add/edit form searches an optimized catalog generated from
`BrickKeeper_DB/parts.csv` and `part_categories.csv`. Records are grouped by
the first normalized character of a part number. This keeps on-demand requests
small while reducing catalog files from 973 to 21.

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

Set inventories and catalog photos are generated from `sets.csv`,
`inventories.csv` and `inventory_parts.csv`:

```powershell
.\tools\build-set-catalog.ps1 path\to\BrickKeeper_DB data\sets
```

Set inventories are grouped in blocks of 10,000 IDs and photos by the first
normalized part-number character. The browser still loads only the required
group, while these two datasets now use 55 files instead of 1,300.

Existing fine-grained JSON shards can be consolidated without rebuilding the
CSV source:

```powershell
.\tools\pack-json-shards.ps1 data\catalog data\catalog-packed array 1
```

## Storage format decision

The user's collection remains JSON because it is portable, editable, easy to
back up and directly writable through the File System Access API.

SQLite would reduce the reference catalog to one file, but browsers do not
provide a native SQLite API. It would require a WebAssembly database engine,
additional runtime code and either a full database download or a specialized
HTTP range-file system. For a dependency-free GitHub Pages application, larger
on-demand JSON groups provide a better startup and maintenance tradeoff.

IndexedDB remains appropriate for local browser-only data such as snapshots.
Moving the reference catalog to SQLite/OPFS should be reconsidered only if the
project accepts a WASM dependency or grows beyond practical static-file sizes.

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

Updated service workers wait until the user selects **Update now** in the
in-app banner. This avoids replacing application code during an active edit.

## JSON format

The current root object contains `schemaVersion: 2`, `appVersion: "1.0b"` and an
`items` array. Required
item fields are `id`, `name`, `partNumber`, `category`, `color` and a
non-negative integer `quantity`. See [`data/bricks.json`](data/bricks.json) for a
complete example.

Schema version 1 documents, unversioned `{ items: [...] }` documents and early
exports containing only an item array are migrated automatically. Files from a
newer unsupported schema are rejected instead of being modified.

## Performance

- no framework, runtime package or production build step;
- one CSS file and focused ES modules with no runtime packages;
- delegated events for all inventory cards;
- card creation in a `DocumentFragment` followed by one DOM update;
- derived filtering without duplicating application state;
- CSS `contain` on cards to limit layout and paint work;
- system fonts and inline SVG icons;
- catalog and set images are the only third-party runtime requests.
- GitHub Actions syntax, migration, full reference-data and Chromium smoke tests
  on every pull request;
- service-worker application-shell caching for repeat and offline visits.

For large collections, cards are appended in fixed-size windows as the user
approaches the end of the currently rendered results.

## Development

Install the optional test-only tooling and run all checks:

```bash
npm install
npm test
npm run test:e2e
```

The deployed application remains static and does not load these development
packages.

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
