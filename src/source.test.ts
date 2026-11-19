import { deepStrictEqual, rejects } from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";

import { tempDir } from "./files.ts";
import * as nix from "./nix.ts";
import { Source, defineSource } from "./source.ts";
import { generateSource } from "./test-support.ts";

test("defineSource shares an archive source with subsequent providers", async () => {
  const definition = defineSource(
    (source) => {
      source.setNixSource("/tmp/source", { version: "1.0.0" }, (attributes) =>
        JSON.stringify(attributes),
      );
    },
    (source) => {
      source.addNixAttribute("npmDepsHash", "sha256-example");
    },
  );

  deepStrictEqual(await generateSource(definition), {
    "source.nix": '{"version":"1.0.0","npmDepsHash":"sha256-example"}',
  });
});

test("nested definitions collect returned files in the same source", async () => {
  const definition = defineSource(
    () => ({ "first.txt": "first" }),
    defineSource(
      (source) => source.addFiles({ "second.txt": "second" }),
      async () => ({ "third.txt": await Promise.resolve("third") }),
    ),
  );
  deepStrictEqual(await generateSource(definition), {
    "first.txt": "first",
    "second.txt": "second",
    "third.txt": "third",
  });
});

test("false discards the entire update even when forced", async () => {
  const definition = defineSource(
    (source) => {
      source.setNixSource("/tmp/source", {}, () => "generated Nix");

      return { "earlier.txt": "discarded" };
    },
    defineSource(() => false),
    () => {
      throw new Error("later definitions must not run");
    },
  );
  deepStrictEqual(await generateSource(definition, "/tmp/package", true), {});
});

test("attribute comparisons remain accurate when updates are forced", async () => {
  await using tmp = await tempDir("nix-repin-skip-test-");
  const file = `${tmp.path}/source.nix`;
  const source = new Source(tmp.path);
  const forced = new Source(tmp.path, true);
  const attributes = { rev: "revision", version: "1.0.0" };
  const unchanged = () => source.matches(attributes);

  deepStrictEqual(await source.matches(attributes), false);
  deepStrictEqual(await source.shouldSkip(unchanged), false);
  await fs.writeFile(file, nix.renderSource([], attributes, "  src = null;"));
  deepStrictEqual(await source.matches(attributes), true);
  deepStrictEqual(await source.matches({ rev: "revision" }), true);
  deepStrictEqual(
    await source.matches({ ...attributes, version: "2.0.0" }),
    false,
  );
  deepStrictEqual(await source.matches({ missing: "value" }), false);
  deepStrictEqual(await source.shouldSkip(unchanged), true);
  deepStrictEqual(await forced.shouldSkip(unchanged), false);
  deepStrictEqual(await forced.matches(attributes), true);

  await fs.rm(file);
  await fs.mkdir(file);
  await rejects(source.shouldSkip(unchanged), { code: "EISDIR" });
  deepStrictEqual(await forced.shouldSkip(unchanged), false);
});
