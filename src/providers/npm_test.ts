import { deepStrictEqual } from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import * as nix from "../nix.ts";
import { defineSource } from "../source.ts";
import { generateSource, withCommands } from "../test_support.ts";
import { pkg, tarball } from "./npm.ts";

test("pkg skips lock generation when the package version is current", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nix-repin-npm-test-"),
  );
  const name = "@scope/program";
  const version = "1.2.3";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(Response.json({ version }));

  try {
    await fs.writeFile(
      `${directory}/package.json`,
      JSON.stringify({ dependencies: { [name]: version } }),
    );

    const files = await generateSource(pkg({ name }), directory);
    deepStrictEqual(files, {});
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("tarball skips the whole source update when its version is current", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nix-repin-npm-test-"),
  );
  const version = "2.0.0-beta.1";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url) => {
    deepStrictEqual(url, "https://registry.example/%40scope%2Fprogram/next");

    return Promise.resolve(
      Response.json({
        version,
        dist: { tarball: "https://registry.example/program.tgz" },
      }),
    );
  };

  try {
    await fs.writeFile(
      `${directory}/source.nix`,
      nix.renderSource(["fetchurl"], { version }, "  src = null;"),
    );
    const definition = defineSource(
      () => ({ "discarded.txt": "earlier output" }),
      tarball({
        name: "@scope/program",
        distTag: "next",
        registry: "https://registry.example",
      }),
      () => {
        throw new Error("later providers must not run");
      },
    );
    deepStrictEqual(await generateSource(definition, directory), {});
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("forcing an npm package regenerates its lock file at the same version", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nix-repin-npm-test-"),
  );
  const name = "@scope/program";
  const version = "1.2.3";
  const lock = '{"lockfileVersion":3}\n';
  const hash = "sha256-Bta1tf1e34LoaOYhd/iN48LkCM7/jfTN4GHKHmi6758=";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(Response.json({ version }));
  try {
    await fs.writeFile(
      `${directory}/package.json`,
      JSON.stringify({ dependencies: { [name]: version } }),
    );
    const files = await withCommands(
      async (program, args, options) => {
        if (program === "npm") {
          await fs.writeFile(`${String(options.cwd)}/package-lock.json`, lock);

          return {};
        }
        deepStrictEqual(program, "prefetch-npm-deps");
        deepStrictEqual(await fs.readFile(args[0], "utf8"), lock);

        return { stdout: hash };
      },
      () => generateSource(pkg({ name }), directory, true),
    );
    deepStrictEqual(files["package-lock.json"], lock);
    deepStrictEqual(JSON.parse(files["package.json"] as string).dependencies, {
      [name]: version,
    });
    deepStrictEqual(
      files["source.nix"],
      `${nix.HEADER}{ }:

{
  version = "${version}";
  npmDepsHash = "${hash}";
}
`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
