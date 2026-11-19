import * as fs from "node:fs/promises";
import { registerHooks } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import type { SourceDefinition } from "./source.ts";
import { Source } from "./source.ts";
import { writeFile } from "./write.ts";

const modUrl = new URL("./mod.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "nix-repin") {
      return { url: modUrl, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});

async function packageDirectories(
  packagesRoot: string,
  packages: string[],
): Promise<string[]> {
  if (packages.length > 0) {
    return packages.map((name) => path.join(packagesRoot, name));
  }

  const directories = [];
  for (const entry of await fs.readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(packagesRoot, entry.name);
    for (const file of await fs.readdir(directory, { withFileTypes: true })) {
      if (file.isFile() && file.name === "source.ts") {
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
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    relative === "default.nix" ||
    relative === "source.ts"
  ) {
    throw new Error(
      `${path.basename(packageDirectory)}: invalid file path ${relativePath}`,
    );
  }

  return file;
}

async function updatePackage(
  packageDirectory: string,
  force: boolean,
): Promise<void> {
  const name = path.basename(packageDirectory);
  const definition: SourceDefinition = (
    await import(
      pathToFileURL(path.resolve(packageDirectory, "source.ts")).href
    )
  ).default;
  const source = new Source(path.resolve(packageDirectory), force);
  await source.apply(definition);

  const changed = (
    await Promise.all(
      Object.entries(source.files()).map(([relativePath, content]) => {
        const target = filePath(packageDirectory, relativePath);

        return writeFile(target, content);
      }),
    )
  ).some(Boolean);

  console.log(changed ? `Updated ${name}` : `${name} is already up to date`);
}

export async function updatePackages(
  packagesRoot: string,
  packages: string[],
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const directories = await packageDirectories(packagesRoot, packages);

  await Promise.all(
    directories.map((directory) => updatePackage(directory, force)),
  );
}
