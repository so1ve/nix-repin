import { deepStrictEqual } from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { defineSource } from "../source.ts";
import { generateSource, withCommands } from "../test_support.ts";
import * as cargo from "./cargo.ts";
import * as npm from "./npm.ts";

test("lock operations use source-relative paths with conventional defaults", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nix-repin-lock-test-"),
  );
  const cargoLock =
    'version = 4\n[[package]]\nname = "example"\nversion = "1.0.0"\n';
  const npmLock = '{"lockfileVersion":3}\n';
  const hash = "sha256-Bta1tf1e34LoaOYhd/iN48LkCM7/jfTN4GHKHmi6758=";
  try {
    await fs.mkdir(`${directory}/app`);
    for (const prefix of ["", "app/"]) {
      await fs.writeFile(`${directory}/${prefix}Cargo.lock`, cargoLock);
      await fs.writeFile(`${directory}/${prefix}package-lock.json`, npmLock);
      const definition = defineSource(
        (source) => source.setNixSource(directory, {}, JSON.stringify),
        prefix ? npm.lock({ path: `${prefix}package-lock.json` }) : npm.lock(),
        prefix ? cargo.lock({ path: `${prefix}Cargo.lock` }) : cargo.lock(),
      );
      const files = await withCommands(
        async (program, args) => {
          deepStrictEqual(program, "prefetch-npm-deps");
          deepStrictEqual(args, [`${directory}/${prefix}package-lock.json`]);
          deepStrictEqual(await fs.readFile(args[0], "utf8"), npmLock);

          return { stdout: hash };
        },
        () => generateSource(definition),
      );
      deepStrictEqual(JSON.parse(files["source.nix"] as string), {
        npmDepsHash: hash,
      });
      deepStrictEqual(files[`${prefix}Cargo.lock`], cargoLock);
      deepStrictEqual(
        (files["cargo-lock.nix"] as string).includes(
          `lockFile = ./${prefix}Cargo.lock;`,
        ),
        true,
      );
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
