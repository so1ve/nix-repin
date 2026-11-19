import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { isNotFound } from "./files.ts";
import type { FileSource } from "./source.ts";

const bufferSize = 64 * 1024;

async function readExact(
  handle: fs.FileHandle,
  buffer: Buffer,
  length: number,
): Promise<number> {
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset);
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }

  return offset;
}

async function filesEqual(
  leftPath: string,
  rightPath: string,
): Promise<boolean> {
  let leftFile: fs.FileHandle;
  try {
    leftFile = await fs.open(leftPath);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }

    throw error;
  }

  await using left = leftFile;
  await using right = await fs.open(rightPath);
  const [leftStat, rightStat] = await Promise.all([left.stat(), right.stat()]);
  if (leftStat.size !== rightStat.size) {
    return false;
  }

  const leftBuffer = Buffer.alloc(bufferSize);
  const rightBuffer = Buffer.alloc(bufferSize);
  let remaining = leftStat.size;
  while (remaining > 0) {
    const length = Math.min(bufferSize, remaining);
    const [leftRead, rightRead] = await Promise.all([
      readExact(left, leftBuffer, length),
      readExact(right, rightBuffer, length),
    ]);
    if (
      leftRead !== length ||
      rightRead !== length ||
      !leftBuffer.subarray(0, length).equals(rightBuffer.subarray(0, length))
    ) {
      return false;
    }

    remaining -= length;
  }

  return true;
}

export async function writeFile(
  file: string,
  source: FileSource,
): Promise<boolean> {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.nix-repin-${randomBytes(8).toString("hex")}`,
  );
  let renamed = false;
  try {
    if (source instanceof URL) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(
          `failed to download ${source.href}: ${response.status}`,
        );
      }
      await fs.writeFile(temporary, response.body as AsyncIterable<Uint8Array>);
    } else {
      await fs.writeFile(temporary, source);
    }

    if (await filesEqual(file, temporary)) {
      return false;
    }

    await fs.chmod(temporary, 0o644);
    await fs.rename(temporary, file);
    renamed = true;

    return true;
  } finally {
    if (!renamed) {
      await fs.rm(temporary, { force: true });
    }
  }
}
