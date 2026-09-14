import * as path from "@std/path";

/** Copy a tree into a writable directory, preserving symlinks and modes. */
export async function copyTree(from: string, to: string): Promise<void> {
  const stat = await Deno.lstat(from);
  if (stat.isSymlink) {
    await Deno.symlink(await Deno.readLink(from), to);
    return;
  }

  if (stat.isDirectory) {
    await Deno.mkdir(to, { recursive: true });
    for await (const entry of Deno.readDir(from)) {
      await copyTree(path.join(from, entry.name), path.join(to, entry.name));
    }
  } else {
    await Deno.copyFile(from, to);
  }

  // The source may be a read-only store path, but the copy has to be mutable.
  await Deno.chmod(to, ((stat.mode ?? 0o644) & 0o777) | 0o200);
}
