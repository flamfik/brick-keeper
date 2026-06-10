# Contributing

## Local setup

No dependencies are required to run the application. Serve the directory over
HTTP:

```bash
node tools/server.mjs
```

Open <http://localhost:8080> and use browser developer tools for testing.

Optional automated tests use development-only packages:

```bash
npm install
npm test
npm run test:e2e
```

## Change guidelines

- keep the application dependency-free unless a dependency solves a measured,
  documented problem;
- preserve stable category and color keys in saved data;
- add every user-facing string to all three language dictionaries;
- use semantic HTML and verify keyboard operation;
- do not insert user data with `innerHTML`;
- keep comments focused on constraints and non-obvious decisions;
- test import/export after changing the schema or storage layer.

## Manual test checklist

1. Load the starter collection with an empty `localStorage`.
2. Search by name and part number.
3. Filter by category and color, then clear filters.
4. Add, edit, count and delete an item.
5. Add, replace and remove a JPG, PNG or WebP photo.
6. Switch between PL, EN and ES.
7. Export data, change the collection and import the exported file.
8. Reload the page and verify persistence, including the photo.
9. Check desktop and mobile widths.
10. Add the same part and color twice; verify that the quantities merge.
11. Install the PWA and verify that the application shell opens offline.
12. Verify that a waiting service worker shows the update banner.

## Pull requests

Describe the behavior changed, why it changed and how it was verified. Include
screenshots for visible interface changes.
