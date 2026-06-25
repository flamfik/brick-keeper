import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringifyCsvRows } from "../js/csv.js";

const sourcePath = resolve(process.argv[2] ?? ".cache/brick-db/colors.csv");
const outputPath = resolve(process.argv[3] ?? "data/colors.csv");
const rows = readFileSync(sourcePath, "utf8").trim().split(/\r?\n/).slice(1);

const colors = rows
  .map((line) => {
    const [id, name, rgb, transparent, partCount] = line.split(",");
    return [id, name, `#${rgb.toUpperCase()}`, transparent === "True", Number(partCount)];
  })
  .filter(([id]) => id !== "-1" && id !== "9999")
  .sort((a, b) => b[4] - a[4] || a[1].localeCompare(b[1]));

writeFileSync(outputPath, stringifyCsvRows([
  ["id", "name", "hex", "transparent", "partCount"],
  ...colors.map(([id, name, hex, transparent, partCount]) => [
    id,
    name,
    hex,
    transparent ? "true" : "false",
    partCount
  ])
]));

console.log(`Built ${colors.length} colors.`);
