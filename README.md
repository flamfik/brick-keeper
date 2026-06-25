# Brick Keeper v1.0b

Brick Keeper is a fast browser and Tauri 2 desktop organizer for a LEGO brick
collection. It supports Polish, English and Spanish and keeps collection data
on the user's computer.

> LEGO is a trademark of the LEGO Group, which does not sponsor, authorize or
> endorse this project.

## Features

- collection dashboard with totals for parts, pieces and colors;
- instant search, category/color filters and sorting;
- adding, editing, deleting and quickly counting parts;
- optional part photos, resized and compressed locally before saving;
- automatic catalog photos selected by part number and color;
- SQLite-backed part-number lookup in the Tauri desktop shell;
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
- import and export using a documented JSON migration format;
- SQLite persistence and reference lookup in the Tauri 2 desktop shell;
- local fallback persistence when no file is connected;
- Polish, English and Spanish interface;
- responsive, keyboard-friendly interface with no runtime dependencies.

## Run Locally

ES modules and `fetch()` require an HTTP server. With Node.js 20+ run:

```bash
node tools/server.mjs
```

Then open <http://localhost:8080>.

Any static server works as well, for example:

```bash
python -m http.server 8080
```

## Tauri 2 Desktop App

Install the current stable Rust toolchain, the platform prerequisites listed in
the [Tauri documentation](https://v2.tauri.app/start/prerequisites/) and the
project's development packages:

```bash
npm install
npm run tauri:dev
```

Create an installer or platform bundle with:

```bash
npm run tauri:build
```

`tools/build-tauri.mjs` copies only the runtime HTML, CSS, JavaScript, icons and
CSV seed data to `dist/`. On first run, Tauri imports that seed into SQLite.
The repository, tests and raw `BrickKeeper_DB` source files are not shipped.

## Project Structure

```text
.
|-- data/
|   |-- catalog/          # generated CSV source for SQL/reference imports
|   |-- sets/             # generated CSV source for SQL/reference imports
|   |-- colors.csv        # generated CSV source for colors
|   `-- bricks.json       # starter inventory and JSON format example
|-- docs/
|   `-- ARCHITECTURE.md   # technical architecture and extension guide
|-- js/
|   |-- app.js            # state, rendering and user interaction
|   |-- csv.js            # compact CSV parser/stringifier
|   |-- file-storage.js   # connected JSON file and remembered permissions
|   |-- i18n.js           # translations and interpolation
|   |-- inventory.js      # duplicate identity and merge rules
|   |-- sql-storage.js    # Tauri SQLite command adapter
|   `-- storage.js        # persistence, validation, import/export
|-- src-tauri/            # Tauri 2 shell, SQLite schema and native commands
|-- tools/
|   `-- server.mjs        # optional zero-dependency development server
|-- manifest.webmanifest  # installable PWA metadata
|-- service-worker.js     # offline application-shell cache
|-- index.html            # semantic application shell and templates
`-- styles.css            # responsive visual system
```

## Data Storage

`data/bricks.json` provides the initial collection and migration example. In the
Tauri desktop build, the active collection is stored in `brick-keeper.sqlite3`
inside the application data directory.

JSON remains useful for import/export, manual backups and migrating existing
Brick Keeper collections into SQLite.

When no file is connected, the app keeps a fallback copy in `localStorage`.
This fallback is tied to the exact site address, so `localhost`, GitHub Pages
and a directly opened `file://` page do not share the same collection. The app
also requests persistent browser storage where supported.

Direct file access in the web build requires a Chromium-based browser such as
Chrome or Edge and a secure origin such as HTTPS or `http://localhost`. The
Tauri build uses native Rust commands and SQLite for persistence.

Photos are stored as compressed WebP data URLs in the item's optional `image`
field. This keeps exported JSON self-contained. Browser storage is limited, so
large photo collections should be exported regularly.

Automatically selected catalog photos are stored as HTTPS references in
`catalogImage` and loaded from Rebrickable's CDN. A user-uploaded photo takes
priority and remains embedded in the JSON collection file.

## SQL Database

The Tauri application creates `brick-keeper.sqlite3` with these tables:

- `inventory_items`
- `colors`
- `parts`
- `sets`
- `set_parts`
- `catalog_photos`

The desktop runtime uses these tables for the active inventory, official colors,
part-number search, set search, required set parts and catalog-photo lookup.
Generated CSV files are imported into SQLite during startup when the bundled
reference version changes. JSON file import/export remains as the human-readable
migration and backup boundary.

## Reference Sources

Reference source files are generated as flat CSV seed files:

- `data/colors.csv` stores color ID, name, hex, transparency and popularity.
- `data/catalog/*.csv` stores part number, name, app category, source category
  and material.
- `data/sets/index.csv` stores searchable set metadata.
- `data/sets/parts/*.csv` stores required parts grouped by 10,000 inventory IDs.
- `data/sets/photos/*.csv` stores catalog-photo URLs grouped by part prefix.

In the Tauri build, those seed files are not queried directly after import.
They exist to rebuild or refresh the SQLite reference tables and to keep the
static web/PWA fallback usable without a native database.

Rebuild the part catalog after replacing the source CSV files:

```bash
node tools/build-catalog.mjs path/to/BrickKeeper_DB data/catalog
```

Rebuild the color catalog:

```bash
node tools/build-colors.mjs path/to/BrickKeeper_DB/colors.csv data/colors.csv
```

Rebuild set inventories and catalog photos:

```bash
node tools/build-set-catalog.mjs path/to/BrickKeeper_DB data/sets
```

## Format Decision

JSON is no longer the database model. SQLite is the desktop persistence layer
because it gives transactions, indexes, schema migrations and a single durable
file. JSON remains a migration and backup format because it is easy to inspect
and exchange.

SQLite would reduce the reference catalog to one file, but browsers do not
provide a native SQLite API. It would require a WebAssembly database engine,
additional runtime code and either a full database download or a specialized
HTTP range-file system. For the stand-alone Tauri application, native SQLite is
the better tradeoff.

IndexedDB remains appropriate for local browser-only data such as snapshots.
Moving the reference catalog to SQLite/OPFS should be reconsidered only if the
project accepts a WASM dependency or grows beyond practical static-file sizes.

Legacy color keys from earlier Brick Keeper releases are resolved to their
official IDs automatically. New records store the stable CSV color ID.

## Deploy To GitHub Pages

1. Create a GitHub repository and push this directory.
2. Open **Settings -> Pages** in the repository.
3. Select **Deploy from a branch**, branch `main`, directory `/ (root)`.
4. Save. GitHub will publish the static application.

No build command or environment variables are required.

## Offline Installation

Brick Keeper includes a web app manifest and service worker. In Chrome or Edge,
use the browser's **Install app** action to run it in a standalone window. The
application shell, starter data and color catalog work offline. Part catalog
shards become available offline after they have been opened once.

Updated service workers wait until the user selects **Update now** in the
in-app banner. This avoids replacing application code during an active edit.

## JSON Collection Format

The current root object contains `schemaVersion: 2`, `appVersion: "1.0b"` and an
`items` array. Required item fields are `id`, `name`, `partNumber`, `category`,
`color` and a non-negative integer `quantity`. See
[`data/bricks.json`](data/bricks.json) for a complete example.

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
- SQLite reference queries in Tauri and CSV reference fallback on the web;
- catalog and set images are the only third-party runtime requests;
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
