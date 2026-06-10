import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const requestedStdoutSize = process.argv[2] === "--stdout"
  ? Number.parseInt(process.argv[3], 10)
  : null;
const sizes = requestedStdoutSize ? [requestedStdoutSize] : [192, 512];
const outputDirectory = resolve(process.argv[2] ?? "icons");

if (!requestedStdoutSize) mkdirSync(outputDirectory, { recursive: true });

for (const size of sizes) {
  const pixels = Buffer.alloc(size * size * 4);
  drawIcon(pixels, size);
  const png = encodePng(pixels, size, size);
  if (requestedStdoutSize) {
    console.log(png.toString("base64"));
  } else {
    writeFileSync(resolve(outputDirectory, `app-icon-${size}.png`), png);
  }
}

if (!requestedStdoutSize) console.log("Built 192px and 512px PWA icons.");

function drawIcon(pixels, size) {
  fillRect(pixels, size, 0, 0, size, size, [23, 79, 63, 255]);
  fillRect(pixels, size, 0.16 * size, 0.35 * size, 0.68 * size, 0.44 * size, [212, 240, 77, 255]);
  fillRect(pixels, size, 0.16 * size, 0.35 * size, 0.68 * size, 0.15 * size, [244, 241, 234, 255]);
  fillRect(pixels, size, 0.28 * size, 0.59 * size, 0.44 * size, 0.095 * size, [23, 79, 63, 255]);

  for (const centerX of [0.29, 0.5, 0.71]) {
    fillEllipse(pixels, size, centerX * size, 0.35 * size, 0.082 * size, 0.043 * size, [23, 79, 63, 255]);
  }
}

function fillRect(pixels, size, x, y, width, height, color) {
  const left = Math.max(0, Math.round(x));
  const top = Math.max(0, Math.round(y));
  const right = Math.min(size, Math.round(x + width));
  const bottom = Math.min(size, Math.round(y + height));

  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      setPixel(pixels, size, column, row, color);
    }
  }
}

function fillEllipse(pixels, size, centerX, centerY, radiusX, radiusY, color) {
  const left = Math.max(0, Math.floor(centerX - radiusX));
  const right = Math.min(size - 1, Math.ceil(centerX + radiusX));
  const top = Math.max(0, Math.floor(centerY - radiusY));
  const bottom = Math.min(size - 1, Math.ceil(centerY + radiusY));

  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const x = (column - centerX) / radiusX;
      const y = (row - centerY) / radiusY;
      if ((x * x) + (y * y) <= 1) setPixel(pixels, size, column, row, color);
    }
  }
}

function setPixel(pixels, size, x, y, [red, green, blue, alpha]) {
  const offset = ((y * size) + x) * 4;
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
  pixels[offset + 3] = alpha;
}

function encodePng(pixels, width, height) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const targetOffset = row * (width * 4 + 1);
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, row * width * 4, (row + 1) * width * 4);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    signature,
    createChunk("IHDR", header),
    createChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    createChunk("IEND", Buffer.alloc(0))
  ]);
}

function createChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
