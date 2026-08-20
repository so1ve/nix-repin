import * as path from "@std/path";

import type { SourceDefinition } from "./source.ts";
import { writeFile } from "./write.ts";

async function packageDirectories(
  packagesRoot: string,
  packages: string[],
): Promise<string[]> {
  if (packages.length > 0) {
    return packages.map((name) => path.join(packagesRoot, name));
  }

  const directories = [];
  for await (const entry of Deno.readDir(packagesRoot)) {
    if (!entry.isDirectory) {
      continue;
    }

    const directory = path.join(packagesRoot, entry.name);
    for await (const file of Deno.readDir(directory)) {
      if (file.isFile && file.name === "source.ts") {
        directories.push(directory);
        break;
      }
    }
  }
  directories.sort();

  return directories;
}

function filePath(packageDirectory: string, relativePath: string): string {
  const file = path.resolve(packageDirectory, relativePath);
  const relative = path.relative(packageDirectory, file);
  if (
    relative === ".." || relative.startsWith(`..${path.SEPARATOR}`) ||
    relative === "default.nix" || relative === "source.ts"
  ) {
    throw new Error(
      `${path.basename(packageDirectory)}: invalid file path ${relativePath}`,
    );
  }

  return file;
}

async function updatePackage(packageDirectory: string): Promise<void> {
  const name = path.basename(packageDirectory);
  const definition: SourceDefinition = (await import(
    path.toFileUrl(path.resolve(packageDirectory, "source.ts")).href
  )).default;
  const files = await definition({
    packageDirectory: path.resolve(packageDirectory),
  });
  const changed = (await Promise.all(
    Object.entries(files).map(([relativePath, source]) => {
      const target = filePath(packageDirectory, relativePath);

      return writeFile(target, source);
    }),
  )).some(Boolean);

  console.log(
    changed ? `Updated ${name}` : `${name} is already up to date`,
  );
}

export async function updatePackages(
  packagesRoot: string,
  packages: string[],
): Promise<void> {
  const directories = await packageDirectories(packagesRoot, packages);

  await Promise.all(directories.map(updatePackage));
}
