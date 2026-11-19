import { deepStrictEqual, rejects } from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";

import { tempDir } from "../files.ts";
import * as nix from "../nix.ts";
import type { SourceDefinition } from "../source.ts";
import { defineSource } from "../source.ts";
import { generateSource, withCommands } from "../test-support.ts";
import * as pnpm from "./pnpm.ts";
import * as yarn from "./yarn.ts";

const derivation = "/nix/store/example-dependencies.drv";
const hash = "sha256-Bta1tf1e34LoaOYhd/iN48LkCM7/jfTN4GHKHmi6758=";

async function generate(
  lock: SourceDefinition,
  attribute: string,
  hashAttribute: string,
  stderr: string,
) {
  await using tmp = await tempDir("nix-repin-dependency-test-");
  await fs.writeFile(`${tmp.path}/flake.nix`, "{}");
  const definition = defineSource((source) => {
    source.setNixSource("/tmp/source", { version: "1.0.0" }, (attributes) =>
      nix.renderSource([], attributes, "  src = null;"),
    );
  }, lock);

  return withCommands(
    (program, args) => {
      deepStrictEqual(program, "nix");
      if (args[0] === "eval") {
        const expression = args.at(-1)!;
        deepStrictEqual(expression.includes(`}).${attribute}).drvPath`), true);
        deepStrictEqual(
          expression.includes(`${hashAttribute} = pkgs.lib.fakeHash;`),
          true,
        );

        return { stdout: derivation };
      }
      deepStrictEqual(args, ["build", "--no-link", `${derivation}^out`]);

      return { code: 1, stderr };
    },
    () => generateSource(definition, tmp.path),
  );
}

test("lock providers select Yarn caches and nested dependency derivations", async () => {
  for (const [lock, attribute, hashAttribute] of [
    [yarn.lock(), "yarnOfflineCache", "yarnDepsHash"],
    [yarn.lock({ attribute: "offlineCache" }), "offlineCache", "yarnDepsHash"],
    [
      pnpm.lock({ attribute: "frontend.pnpmDeps" }),
      "frontend.pnpmDeps",
      "pnpmDepsHash",
    ],
  ] as const) {
    const files = await generate(
      lock,
      attribute,
      hashAttribute,
      `error: hash mismatch in fixed-output derivation '${derivation}':
       specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
            got: ${hash}`,
    );
    deepStrictEqual(
      files["source.nix"],
      nix.renderSource(
        [],
        {
          version: "1.0.0",
          [hashAttribute]: hash,
        },
        "  src = null;",
      ),
    );
  }
});

test("lock providers propagate failures instead of using another derivation's hash", async () => {
  await rejects(
    generate(
      yarn.lock(),
      "yarnOfflineCache",
      "yarnDepsHash",
      `error: hash mismatch in fixed-output derivation '/nix/store/other-source.drv':\n got: ${hash}`,
    ),
    /other-source\.drv/,
  );
  await rejects(
    generate(
      yarn.lock(),
      "yarnOfflineCache",
      "yarnDepsHash",
      "error: download failed",
    ),
    /download failed/,
  );
});
