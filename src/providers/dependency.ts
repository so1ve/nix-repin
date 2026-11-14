import assert from "node:assert/strict";

import { runCommand } from "../command.ts";
import * as nix from "../nix.ts";
import type { SourceDefinition } from "../source.ts";

/** Build a dependency derivation and write its actual fixed-output hash. */
export function dependencyHash(
  attribute: string,
  hashAttribute: string,
): SourceDefinition {
  return async (source) => {
    const root = await nix.findFlakeRoot(source.packageDirectory);
    const generated = source.files()["source.nix"];
    assert(
      typeof generated === "string",
      `${hashAttribute} requires an archive source`,
    );

    const directory = await Deno.makeTempDir({
      prefix: "nix-repin-dependency-",
    });
    try {
      await Deno.writeTextFile(`${directory}/source.nix`, generated);
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

      const derivation = await runCommand("nix", [
        "eval",
        "--raw",
        "--impure",
        "--expr",
        `(${expression}).drvPath`,
      ]);

      try {
        await runCommand("nix", [
          "build",
          "--no-link",
          `${derivation}^out`,
        ]);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        const marker =
          `hash mismatch in fixed-output derivation '${derivation}':`;
        const position = error.message.indexOf(marker);
        const hash = position < 0 ? undefined : error.message.slice(
          position + marker.length,
        ).match(/\bgot:\s+(sha256-[A-Za-z0-9+/]{43}=)/)?.[1];
        if (!hash) throw error;

        source.addNixAttribute(hashAttribute, hash);
        return;
      }

      throw new Error(`${derivation}: expected a fixed-output hash mismatch`);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  };
}
