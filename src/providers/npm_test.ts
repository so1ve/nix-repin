import { deepStrictEqual } from "node:assert";

import * as nix from "../nix.ts";
import { defineSource, provider } from "../source.ts";
import { pkg, tarball } from "./npm.ts";

Deno.test("pkg skips lock generation when the package version is current", async () => {
  const directory = await Deno.makeTempDir({ prefix: "nix-repin-npm-test-" });
  const name = "@scope/program";
  const version = "1.2.3";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(Response.json({ version }));

  try {
    await Deno.writeTextFile(
      `${directory}/package.json`,
      JSON.stringify({ dependencies: { [name]: version } }),
    );

    const files = await pkg({ name })({ packageDirectory: directory });
    deepStrictEqual(files, {});
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("tarball skips the whole source update when its version is current", async () => {
  const directory = await Deno.makeTempDir({ prefix: "nix-repin-npm-test-" });
  const version = "2.0.0-beta.1";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url) => {
    deepStrictEqual(
      url,
      "https://registry.example/%40scope%2Fprogram/next",
    );
    return Promise.resolve(Response.json({
      version,
      dist: { tarball: "https://registry.example/program.tgz" },
    }));
  };

  try {
    await Deno.writeTextFile(
      `${directory}/source.nix`,
      nix.renderSource(["fetchurl"], { version }, "  src = null;"),
    );
    const definition = defineSource(
      provider(() => ({ "discarded.txt": "earlier output" })),
      tarball({
        name: "@scope/program",
        distTag: "next",
        registry: "https://registry.example",
      }),
      provider(() => {
        throw new Error("later providers must not run");
      }),
    );
    deepStrictEqual(await definition({ packageDirectory: directory }), {});
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(directory, { recursive: true });
  }
});
