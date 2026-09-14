import { runCommand } from "../command.ts";
import * as nix from "../nix.ts";
import {
  provider,
  type SourceDefinition,
  type SourceFiles,
} from "../source.ts";

export interface PackageOptions {
  /** npm distribution tag to track. */
  distTag?: string;
  /** Published npm package name. */
  name: string;
  /** npm registry base URL without a trailing slash. */
  registry?: string;
}

const defaultRegistry = "https://registry.npmjs.org";

function hash(path: string): Promise<string> {
  return runCommand("prefetch-npm-deps", [path]);
}

/** Generate npmDepsHash from a package-lock.json in an archive source. */
export function lock(path: string): SourceDefinition {
  return provider(async (source) => {
    source.addNixAttribute("npmDepsHash", await hash(source.sourceFile(path)));
  });
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
  try {
    const manifest = JSON.parse(
      await Deno.readTextFile(`${packageDirectory}/package.json`),
    ) as {
      dependencies: Record<string, string>;
    };

    return manifest.dependencies[name];
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }

    throw error;
  }
}

async function latestVersion(
  name: string,
  distTag: string,
  registry: string,
): Promise<string> {
  const url = `${registry}/${encodeURIComponent(name)}/${
    encodeURIComponent(distTag)
  }`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name}: ${url} returned ${response.status}`);
  }

  return (await response.json() as { version: string }).version;
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
    await runCommand("npm", [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `--registry=${registry}`,
    ], {
      cwd: directory,
      env: { NPM_CONFIG_CACHE: `${directory}/cache` },
    });

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

  return provider(async (source) => {
    const version = await latestVersion(
      options.name,
      options.distTag ?? "latest",
      registry,
    );
    if (
      await currentVersion(source.packageDirectory, options.name) === version
    ) {
      return;
    }

    const manifest = packageJson(options.name, version);
    return lockedPackage(version, registry, manifest);
  });
}
