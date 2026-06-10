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
- import and export using a documented JSON format;
- local persistence with `localStorage`;
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
│   ├── i18n.js           # translations and interpolation
│   └── storage.js        # persistence, validation, import/export
├── tools/
│   └── server.mjs        # optional zero-dependency development server
├── index.html            # semantic application shell and templates
└── styles.css            # responsive visual system
```

## Data storage

`data/bricks.json` provides the initial collection. On first use it is copied to
the browser's `localStorage`; subsequent edits stay there. Use **Export** to
download the current collection and **Import** to restore or move it.

Photos are stored as compressed WebP data URLs in the item's optional `image`
field. This keeps exported JSON self-contained. Browser storage is limited, so
large photo collections should be exported regularly.

Browsers cannot directly overwrite a project JSON file without a backend or
explicit File System Access API permission. This design keeps the app portable,
safe and compatible with static GitHub Pages hosting.

## Deploy to GitHub Pages

1. Create a GitHub repository and push this directory.
2. Open **Settings → Pages** in the repository.
3. Select **Deploy from a branch**, branch `main`, directory `/ (root)`.
4. Save. GitHub will publish the static application.

No build command or environment variables are required.

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

For very large collections (several thousand visible cards), list
virtualization is the next appropriate optimization.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
