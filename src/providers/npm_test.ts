import { pkg } from "./npm.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("pkg skips lock generation when the package version is current", async () => {
  const directory = await Deno.makeTempDir({ prefix: "nix-repin-npm-test-" });
  const name = "@scope/program";
  const version = "1.2.3";
  const originalFetch = globalThis.fetch;
  let requestedUrl: string | URL | Request | undefined;

  globalThis.fetch = (input) => {
    requestedUrl = input;
    return Promise.resolve(Response.json({ version }));
  };

  try {
    await Deno.writeTextFile(
      `${directory}/package.json`,
      JSON.stringify({ dependencies: { [name]: version } }),
    );

    const files = await pkg({ name })({ packageDirectory: directory });

    assert(Object.keys(files).length === 0, "expected no generated files");
    assert(
      String(requestedUrl) ===
        "https://registry.npmjs.org/%40scope%2Fprogram/latest",
      "expected one dist-tag lookup",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(directory, { recursive: true });
  }
});
