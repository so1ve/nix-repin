import assert from "node:assert/strict";
import * as fs from "node:fs/promises";

import { tempDir } from "../files.ts";
import * as nix from "../nix.ts";
import type { SourceDefinition } from "../source.ts";

/**
 * Build a dependency derivation and write its actual fixed-output hash.
 */
export const dependencyHash =
  (attribute: string, hashAttribute: string): SourceDefinition =>
  async (source) => {
    const root = await nix.findFlakeRoot(source.packageDirectory);
    const generated = source.files()["source.nix"];
    assert.ok(
      typeof generated === "string",
      `${hashAttribute} requires an archive source`,
    );

    await using tmp = await tempDir("nix-repin-dependency-");
    const directory = tmp.path;
    await fs.writeFile(`${directory}/source.nix`, generated);
    const expression = `let
  flake = builtins.getFlake ${nix.string(`path:${root}`)};
  pkgs = flake.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  source = (pkgs.callPackage ${nix.string(`${directory}/source.nix`)} { }) // {
    ${hashAttribute} = pkgs.lib.fakeHash;
  };
in
(pkgs.callPackage ${nix.string(`${source.packageDirectory}/default.nix`)} {
  inherit source;
}).${attribute}`;

    source.addNixAttribute(
      hashAttribute,
      await nix.fixedOutputHash(expression),
    );
  };

const lockProvider = (defaultAttribute: string, hashAttribute: string) => ({
  lock: ({
    attribute = defaultAttribute,
  }: { attribute?: string } = {}): SourceDefinition =>
    dependencyHash(attribute, hashAttribute),
});

/**
 * Update bunDepsHash from the package's node_modules derivation.
 */
export const bun = lockProvider("node_modules", "bunDepsHash");

/**
 * Update vendorHash from the package's goModules derivation.
 */
export const go = lockProvider("goModules", "vendorHash");

/**
 * Update pnpmDepsHash from the package's pnpmDeps derivation.
 */
export const pnpm = lockProvider("pnpmDeps", "pnpmDepsHash");

/**
 * Update yarnDepsHash from the package's Yarn offline cache derivation.
 */
export const yarn = lockProvider("yarnOfflineCache", "yarnDepsHash");
