import * as fs from "node:fs/promises";
import * as path from "node:path";

export const isNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export async function readTextFileIfExists(
  file: string,
): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Copy a tree into a writable directory, preserving symlinks and modes.
 */
export async function copyTree(from: string, to: string): Promise<void> {
  const stat = await fs.lstat(from);
  if (stat.isSymbolicLink()) {
    await fs.symlink(await fs.readlink(from), to);

    return;
  }

  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from)) {
      await copyTree(path.join(from, entry), path.join(to, entry));
    }
  } else {
    await fs.copyFile(from, to);
  }

  // The source may be a read-only store path, but the copy has to be mutable.
  await fs.chmod(to, (stat.mode & 0o777) | 0o200);
}
