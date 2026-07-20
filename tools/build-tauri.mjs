import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist");
const files = [
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "styles.css"
];
const directories = ["icons", "js"];
const frontendDataFiles = ["bricks.json", "colors.csv"];

// Large reference CSV files are native bundle resources imported into SQLite.
// The frontend keeps only its small startup and color-catalog fallbacks.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(join(output, "data"), { recursive: true });

await Promise.all([
  ...files.map((name) => cp(join(root, name), join(output, name))),
  ...frontendDataFiles.map((name) => cp(
    join(root, "data", name),
    join(output, "data", name)
  )),
  ...directories.map((name) => cp(
    join(root, name),
    join(output, name),
    { recursive: true }
  ))
]);

console.log(`Tauri frontend assets written to ${output}`);
