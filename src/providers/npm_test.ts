import { deepStrictEqual } from "node:assert";

import { pkg } from "./npm.ts";

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
