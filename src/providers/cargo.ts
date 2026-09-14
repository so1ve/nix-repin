import { parse } from "@std/toml";

import * as nix from "../nix.ts";
import {
  provider,
  type SourceDefinition,
  type SourceFiles,
} from "../source.ts";

interface CargoPackage {
  name: string;
  source?: string;
  version: string;
}

interface CargoLock {
  package: CargoPackage[];
}

interface GitDependency {
  name: string;
  revision: string;
  url: string;
}

function gitDependencies(contents: string): GitDependency[] {
  const dependencies = new Map<string, GitDependency>();
  const lock = parse(contents) as unknown as CargoLock;
  for (const package_ of lock.package) {
    if (!package_.source?.startsWith("git+")) {
      continue;
    }

    const url = new URL(package_.source.slice("git+".length));
    const revision = url.hash.slice(1);
    url.search = "";
    url.hash = "";
    if (!dependencies.has(revision)) {
      dependencies.set(revision, {
        name: `${package_.name}-${package_.version}`,
        revision,
        url: url.href,
      });
    }
  }

  return [...dependencies.values()];
}

function renderLock(
  path: string,
  outputHashes: [name: string, hash: string][],
): string {
  const hashes = outputHashes
    .map(([name, hash]) => `    ${nix.string(name)} = ${nix.string(hash)};`)
    .join("\n");
  const outputHashesBinding = hashes
    ? `
  outputHashes = {
${hashes}
  };`
    : "";

  return `${nix.HEADER}{
  lockFile = ./${path};${outputHashesBinding}
}
`;
}

/** Copy a Cargo lock file from an archive source and generate its output hashes. */
export function lock(path: string): SourceDefinition {
  return provider(async (source) => {
    const contents = await Deno.readTextFile(source.sourceFile(path));
    const outputHashes = await Promise.all(
      gitDependencies(contents).map(async (dependency) =>
        [
          dependency.name,
          await nix.prefetchGit(dependency.url, dependency.revision),
        ] as [string, string]
      ),
    );

    return {
      [path]: contents,
      "cargo-lock.nix": renderLock(path, outputHashes),
    } satisfies SourceFiles;
  });
}
