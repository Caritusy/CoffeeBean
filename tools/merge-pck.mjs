import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const ALIGN = 16;
const align = (value, boundary) => Math.ceil(value / boundary) * boundary;

async function readPack(file) {
  const buffer = await readFile(file);
  if (buffer.toString("ascii", 0, 4) !== "GDPC") throw new Error(`Not a Godot PCK: ${file}`);
  const dataBase = Number(buffer.readBigUInt64LE(24));
  const count = buffer.readUInt32LE(96);
  const files = new Map();
  let cursor = 100;
  for (let index = 0; index < count; index += 1) {
    const nameLength = buffer.readUInt32LE(cursor);
    cursor += 4;
    const name = buffer.subarray(cursor, cursor + nameLength).toString("utf8").replace(/\0+$/, "");
    cursor += nameLength;
    const offset = Number(buffer.readBigUInt64LE(cursor));
    const size = Number(buffer.readBigUInt64LE(cursor + 8));
    cursor += 36;
    files.set(name, Buffer.from(buffer.subarray(dataBase + offset, dataBase + offset + size)));
  }
  return { header: Buffer.from(buffer.subarray(0, 100)), files };
}

function addHitboxAutoload(projectBinary) {
  const key = Buffer.from("autoload/CoffeeBeanHitbox", "utf8");
  if (projectBinary.includes(key)) return projectBinary;
  const value = Buffer.from("*res://CoffeeBeanHitbox.gd", "utf8");
  const paddedValueLength = align(value.length, 4);
  const valueSize = 4 + 4 + paddedValueLength;
  const record = Buffer.alloc(4 + key.length + 4 + valueSize);
  let cursor = 0;
  record.writeUInt32LE(key.length, cursor);
  cursor += 4;
  key.copy(record, cursor);
  cursor += key.length;
  record.writeUInt32LE(valueSize, cursor);
  cursor += 4;
  record.writeUInt32LE(4, cursor);
  cursor += 4;
  record.writeUInt32LE(value.length, cursor);
  cursor += 4;
  value.copy(record, cursor);
  const output = Buffer.concat([projectBinary, record]);
  output.writeUInt32LE(projectBinary.readUInt32LE(4) + 1, 4);
  return output;
}

async function mergePacks(basePath, patchPath, outputPath) {
  const base = await readPack(basePath);
  const patch = await readPack(patchPath);
  base.files.set("project.binary", addHitboxAutoload(base.files.get("project.binary")));
  for (const [name, data] of patch.files) {
    if (name === "CoffeeBeanHitbox.gdc" || name === "CoffeeBeanHitbox.gd.remap") {
      base.files.set(name, data);
    }
  }

  const entries = [];
  let dataOffset = 0;
  for (const [name, data] of base.files) {
    dataOffset = align(dataOffset, ALIGN);
    entries.push({ name, data, offset: dataOffset });
    dataOffset += data.length;
  }

  const tableParts = [];
  for (const entry of entries) {
    const name = Buffer.from(`${entry.name}\0`, "utf8");
    const paddedLength = align(name.length, 4);
    const paddedName = Buffer.alloc(paddedLength);
    name.copy(paddedName);
    const record = Buffer.alloc(4 + paddedLength + 8 + 8 + 16 + 4);
    record.writeUInt32LE(paddedLength, 0);
    paddedName.copy(record, 4);
    record.writeBigUInt64LE(BigInt(entry.offset), 4 + paddedLength);
    record.writeBigUInt64LE(BigInt(entry.data.length), 4 + paddedLength + 8);
    createHash("md5").update(entry.data).digest().copy(record, 4 + paddedLength + 16);
    tableParts.push(record);
  }
  const table = Buffer.concat(tableParts);
  const dataBase = align(100 + table.length, ALIGN);
  const header = Buffer.from(base.header);
  header.writeBigUInt64LE(BigInt(dataBase), 24);
  header.writeUInt32LE(entries.length, 96);
  const output = Buffer.alloc(dataBase + dataOffset);
  header.copy(output, 0);
  table.copy(output, 100);
  for (const entry of entries) entry.data.copy(output, dataBase + entry.offset);
  await writeFile(outputPath, output);
  console.log(`merged ${entries.length} files into ${outputPath} (${output.length} bytes)`);
}

const [basePath, patchPath, outputPath] = process.argv.slice(2);
if (!basePath || !patchPath || !outputPath) {
  throw new Error("Usage: node merge-pck.mjs base.pck patch.pck output.pck");
}
await mergePacks(basePath, patchPath, outputPath);
