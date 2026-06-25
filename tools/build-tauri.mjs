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
const directories = ["data", "icons", "js"];

// Tauri should bundle runtime CSV assets, never the repository or raw DB source.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await Promise.all([
  ...files.map((name) => cp(join(root, name), join(output, name))),
  ...directories.map((name) => cp(
    join(root, name),
    join(output, name),
    { recursive: true }
  ))
]);

console.log(`Tauri frontend assets written to ${output}`);
