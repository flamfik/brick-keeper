# Contributing

## Local setup

No dependencies are required. Serve the directory over HTTP:

```bash
node tools/server.mjs
```

Open <http://localhost:8080> and use browser developer tools for testing.

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

## Pull requests

Describe the behavior changed, why it changed and how it was verified. Include
screenshots for visible interface changes.
