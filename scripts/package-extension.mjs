import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , sourceDirArg, outputArg] = process.argv;

if (!sourceDirArg || !outputArg) {
  console.error('Usage: node scripts/package-extension.mjs <source-dir> <output.zip>');
  process.exit(1);
}

const sourceDir = path.resolve(sourceDirArg);
const outputPath = path.resolve(outputArg);
const skipped = new Set(['.DS_Store', 'Thumbs.db']);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

async function collectFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (skipped.has(entry.name) || entry.name.endsWith('.map')) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push({ fullPath, relativePath });
    }
  }

  return files;
}

const files = await collectFiles(sourceDir);
if (!files.length) {
  console.error(`No files found in ${sourceDir}`);
  process.exit(1);
}

const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of files) {
  const data = await readFile(file.fullPath);
  const fileStat = await stat(file.fullPath);
  const name = Buffer.from(file.relativePath, 'utf8');
  const checksum = crc32(data);
  const { time, day } = dosTimestamp(fileStat.mtime);

  const localHeader = Buffer.concat([
    writeUInt32(0x04034b50),
    writeUInt16(20),
    writeUInt16(0x0800),
    writeUInt16(0),
    writeUInt16(time),
    writeUInt16(day),
    writeUInt32(checksum),
    writeUInt32(data.length),
    writeUInt32(data.length),
    writeUInt16(name.length),
    writeUInt16(0),
    name,
  ]);

  localParts.push(localHeader, data);

  centralParts.push(Buffer.concat([
    writeUInt32(0x02014b50),
    writeUInt16(20),
    writeUInt16(20),
    writeUInt16(0x0800),
    writeUInt16(0),
    writeUInt16(time),
    writeUInt16(day),
    writeUInt32(checksum),
    writeUInt32(data.length),
    writeUInt32(data.length),
    writeUInt16(name.length),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt32(0),
    writeUInt32(offset),
    name,
  ]));

  offset += localHeader.length + data.length;
}

const centralDirectory = Buffer.concat(centralParts);
const endRecord = Buffer.concat([
  writeUInt32(0x06054b50),
  writeUInt16(0),
  writeUInt16(0),
  writeUInt16(files.length),
  writeUInt16(files.length),
  writeUInt32(centralDirectory.length),
  writeUInt32(offset),
  writeUInt16(0),
]);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.concat([...localParts, centralDirectory, endRecord]));

console.log(`Packaged ${files.length} files into ${path.relative(process.cwd(), outputPath)}`);
