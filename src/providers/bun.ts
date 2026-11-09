import assert from "node:assert/strict";

import { runCommand } from "../command.ts";
import * as nix from "../nix.ts";
import { provider, type SourceDefinition } from "../source.ts";

/** Hash the package's node_modules derivation with its repository's toolchain. */
export function lock(): SourceDefinition {
  return provider(async (source) => {
    const root = await nix.findFlakeRoot(source.packageDirectory);
    const generated = source.files()["source.nix"];
    assert(
      typeof generated === "string",
      "bun.lock requires an archive source",
    );

    const directory = await Deno.makeTempDir({ prefix: "nix-repin-bun-" });
    try {
      await Deno.writeTextFile(`${directory}/source.nix`, generated);
      const expression = `let
  flake = builtins.getFlake ${nix.string(`path:${root}`)};
  pkgs = flake.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
  source = (pkgs.callPackage ${nix.string(`${directory}/source.nix`)} { }) // {
    bunDepsHash = pkgs.lib.fakeHash;
  };
in
(pkgs.callPackage ${nix.string(`${source.packageDirectory}/default.nix`)} {
  inherit source;
}).node_modules`;

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

        source.addNixAttribute("bunDepsHash", hash);
        return;
      }

      throw new Error(`${derivation}: expected a fixed-output hash mismatch`);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
}
