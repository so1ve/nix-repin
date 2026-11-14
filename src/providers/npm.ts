import * as path from "@std/path";

import { runCommand } from "../command.ts";
import { readTextFileIfExists } from "../files.ts";
import * as nix from "../nix.ts";
import type { SourceDefinition, SourceFiles } from "../source.ts";
import { fetchurl } from "./fetchurl.ts";

export interface PackageOptions {
  /** npm distribution tag to track. */
  distTag?: string;
  /** Published npm package name. */
  name: string;
  /** npm registry base URL without a trailing slash. */
  registry?: string;
}

export interface LockOptions {
  /** Only resolve versions published on or before this ISO 8601 timestamp. */
  before?: string;
  /** Ignore peer dependencies while resolving the lock file. */
  legacyPeerDeps?: boolean;
  /** npm registry base URL without a trailing slash. */
  registry?: string;
}

const defaultRegistry = "https://registry.npmjs.org";

/** Calculate npmDepsHash from an existing package-lock.json. */
export function hash(path: string): Promise<string> {
  return runCommand("prefetch-npm-deps", [path]);
}

/** Write package-lock.json for a directory's package.json without running scripts. */
export async function writeLock(
  directory: string,
  options: LockOptions = {},
): Promise<void> {
  await runCommand("npm", [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `--registry=${options.registry ?? defaultRegistry}`,
    ...(options.before ? [`--before=${options.before}`] : []),
    ...(options.legacyPeerDeps ? ["--legacy-peer-deps"] : []),
  ], {
    cwd: directory,
    env: { NPM_CONFIG_CACHE: path.resolve(directory, "cache") },
  });
}

/** Generate npmDepsHash from a package-lock.json in an archive source. */
export function lock(
  { path = "package-lock.json" }: { path?: string } = {},
): SourceDefinition {
  return async (source) => {
    source.addNixAttribute("npmDepsHash", await hash(source.sourceFile(path)));
  };
}

function packageJson(name: string, version: string): string {
  const manifest = {
    name: "nix-repin-package",
    private: true,
    version,
    dependencies: { [name]: version },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function sourceNix(version: string, npmDepsHash: string): string {
  return `${nix.HEADER}{ }:

{
  version = ${nix.string(version)};
  npmDepsHash = ${nix.string(npmDepsHash)};
}
`;
}

async function currentVersion(
  packageDirectory: string,
  name: string,
): Promise<string | undefined> {
  const contents = await readTextFileIfExists(
    `${packageDirectory}/package.json`,
  );
  if (contents === undefined) return undefined;
  const manifest = JSON.parse(contents) as {
    dependencies: Record<string, string>;
  };

  return manifest.dependencies[name];
}

async function packageMetadata(
  name: string,
  distTag: string,
  registry: string,
): Promise<{ version: string; dist: { tarball: string } }> {
  const url = `${registry}/${encodeURIComponent(name)}/${
    encodeURIComponent(distTag)
  }`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name}: ${url} returned ${response.status}`);
  }

  return response.json();
}

async function lockedPackage(
  version: string,
  registry: string,
  manifest: string,
): Promise<SourceFiles> {
  const directory = await Deno.makeTempDir({ prefix: "nix-repin-npm-" });
  const lockPath = `${directory}/package-lock.json`;
  try {
    await Deno.writeTextFile(`${directory}/package.json`, manifest);
    await writeLock(directory, { registry });

    const lock = await Deno.readTextFile(lockPath);
    const npmDepsHash = await hash(lockPath);
    return {
      "package.json": manifest,
      "package-lock.json": lock,
      "source.nix": sourceNix(version, npmDepsHash),
    };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

/** Track an npm dist-tag and generate a lock file plus its fixed-output hash. */
export function pkg(options: PackageOptions): SourceDefinition {
  const registry = options.registry ?? defaultRegistry;

  return async (source) => {
    const { version } = await packageMetadata(
      options.name,
      options.distTag ?? "latest",
      registry,
    );
    if (
      await source.shouldSkip(async () =>
        await currentVersion(source.packageDirectory, options.name) === version
      )
    ) {
      return false;
    }

    const manifest = packageJson(options.name, version);
    return lockedPackage(version, registry, manifest);
  };
}

/** Track an npm dist-tag and generate a fetchurl source for its published tarball. */
export function tarball(options: PackageOptions): SourceDefinition {
  return async (source) => {
    const { version, dist } = await packageMetadata(
      options.name,
      options.distTag ?? "latest",
      options.registry ?? defaultRegistry,
    );
    if (await source.shouldSkip(() => source.matches({ version }))) {
      return false;
    }

    return fetchurl({ version, urls: { default: dist.tarball } });
  };
}
