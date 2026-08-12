import { equals } from "@std/bytes/equals";
import * as path from "@std/path";

import type { FileSource } from "./source.ts";

const bufferSize = 64 * 1024;

async function filesEqual(
  leftPath: string,
  rightPath: string,
): Promise<boolean> {
  let leftFile: Deno.FsFile;
  try {
    leftFile = await Deno.open(leftPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }

  using left = leftFile;
  using right = await Deno.open(rightPath);
  const [leftStat, rightStat] = await Promise.all([
    left.stat(),
    right.stat(),
  ]);
  if (leftStat.size !== rightStat.size) {
    return false;
  }

  const leftReader = left.readable.getReader({ mode: "byob" });
  const rightReader = right.readable.getReader({ mode: "byob" });
  let leftBuffer = new Uint8Array(bufferSize);
  let rightBuffer = new Uint8Array(bufferSize);
  let remaining = leftStat.size;
  while (remaining > 0) {
    const length = Math.min(bufferSize, remaining);
    const [leftResult, rightResult] = await Promise.all([
      leftReader.read(leftBuffer, { min: length }),
      rightReader.read(rightBuffer, { min: length }),
    ]);
    const leftChunk = leftResult.value!;
    const rightChunk = rightResult.value!;
    if (leftChunk.length !== length || !equals(leftChunk, rightChunk)) {
      return false;
    }

    leftBuffer = new Uint8Array(leftChunk.buffer);
    rightBuffer = new Uint8Array(rightChunk.buffer);
    remaining -= length;
  }

  return true;
}

export async function writeFile(
  file: string,
  source: FileSource,
): Promise<boolean> {
  const directory = path.dirname(file);
  await Deno.mkdir(directory, { recursive: true });
  const temporary = await Deno.makeTempFile({
    dir: directory,
    prefix: ".nix-repin-",
  });
  let renamed = false;
  try {
    if (source instanceof URL) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`failed to download ${source}: ${response.status}`);
      }
      await Deno.writeFile(temporary, response.body!);
    } else if (typeof source === "string") {
      await Deno.writeTextFile(temporary, source);
    } else {
      await Deno.writeFile(temporary, source);
    }

    if (await filesEqual(file, temporary)) {
      return false;
    }

    await Deno.chmod(temporary, 0o644);
    await Deno.rename(temporary, file);
    renamed = true;

    return true;
  } finally {
    if (!renamed) {
      await Deno.remove(temporary);
    }
  }
}
