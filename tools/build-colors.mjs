import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve(process.argv[2] ?? ".cache/brick-db/colors.csv");
const outputPath = resolve(process.argv[3] ?? "data/colors.json");
const rows = readFileSync(sourcePath, "utf8").trim().split(/\r?\n/).slice(1);

const colors = rows
  .map((line) => {
    const [id, name, rgb, transparent, partCount] = line.split(",");
    return [id, name, `#${rgb.toUpperCase()}`, transparent === "True", Number(partCount)];
  })
  .filter(([id]) => id !== "-1" && id !== "9999")
  .sort((a, b) => b[4] - a[4] || a[1].localeCompare(b[1]));

writeFileSync(outputPath, JSON.stringify({
  schemaVersion: 1,
  source: "BrickKeeper_DB/colors.csv",
  colors
}));

console.log(`Built ${colors.length} colors.`);
