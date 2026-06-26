import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

const outputDirectory = ".mysql-import";

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const outputs = [
  await combineCsvDirectory({
    sourceDirectory: "data/catalog",
    outputPath: join(outputDirectory, "parts.csv"),
    skipFiles: new Set(["manifest.csv"])
  }),
  await copyCsv({
    sourcePath: "data/sets/index.csv",
    outputPath: join(outputDirectory, "sets.csv")
  }),
  await combineCsvDirectory({
    sourceDirectory: "data/sets/parts",
    outputPath: join(outputDirectory, "set_parts.csv")
  }),
  await combineCsvDirectory({
    sourceDirectory: "data/sets/photos",
    outputPath: join(outputDirectory, "catalog_photos.csv")
  }),
  await copyCsv({
    sourcePath: "data/colors.csv",
    outputPath: join(outputDirectory, "colors.csv")
  })
];

for (const output of outputs) {
  console.log(`${output.path}: ${output.records.toLocaleString("en-US")} records`);
}

async function copyCsv({ sourcePath, outputPath }) {
  await cp(sourcePath, outputPath);
  const records = await countCsvRecords(outputPath);
  return { path: outputPath, records };
}

async function combineCsvDirectory({ sourceDirectory, outputPath, skipFiles = new Set() }) {
  const files = (await readdir(sourceDirectory))
    .filter((file) => file.endsWith(".csv") && !skipFiles.has(file))
    .sort((a, b) => a.localeCompare(b, "en"));
  const writer = createWriteStream(outputPath, { encoding: "utf8" });
  let expectedHeader = null;
  let records = 0;

  try {
    for (const file of files) {
      const inputPath = join(sourceDirectory, file);
      let lineNumber = 0;
      const lines = createInterface({
        input: createReadStream(inputPath, { encoding: "utf8" }),
        crlfDelay: Infinity
      });

      for await (let line of lines) {
        if (lineNumber === 0) {
          line = line.replace(/^\uFEFF/, "");
          if (expectedHeader === null) {
            expectedHeader = line;
            writer.write(`${line}\n`);
          } else if (line !== expectedHeader) {
            throw new Error(`Header mismatch in ${inputPath}. Expected ${expectedHeader}, got ${line}`);
          }
        } else if (line.trim() !== "") {
          writer.write(`${line}\n`);
          records += 1;
        }
        lineNumber += 1;
      }

      if (lineNumber === 0) {
        throw new Error(`CSV file is empty: ${inputPath}`);
      }
    }
  } finally {
    writer.end();
  }

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  if (expectedHeader === null) {
    throw new Error(`No CSV files found in ${sourceDirectory}`);
  }

  return { path: outputPath, records };
}

async function countCsvRecords(path) {
  let lines = 0;
  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (line.trim() !== "") {
      lines += 1;
    }
  }

  return Math.max(0, lines - 1);
}
