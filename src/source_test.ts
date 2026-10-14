import { defineSource, provider } from "./source.ts";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("defineSource shares an archive source with subsequent providers", async () => {
  const definition = defineSource(
    provider((source) => {
      source.setNixSource(
        "/tmp/source",
        { version: "1.0.0" },
        (attributes) => JSON.stringify(attributes),
      );
    }),
    provider((source) => {
      source.addNixAttribute("npmDepsHash", "sha256-example");
    }),
  );

  const files = await definition({ packageDirectory: "/tmp/package" });
  assert(
    files["source.nix"] ===
      '{"version":"1.0.0","npmDepsHash":"sha256-example"}',
    "expected the second provider to extend the generated source",
  );
});
