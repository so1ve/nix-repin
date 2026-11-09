import { deepStrictEqual, rejects } from "node:assert/strict";

import { defineSource, provider } from "../source.ts";
import { lock } from "./bun.ts";

const derivation = "/nix/store/example-node_modules.drv";
const hash = "sha256-Bta1tf1e34LoaOYhd/iN48LkCM7/jfTN4GHKHmi6758=";

async function generate(stderr: string) {
  const directory = await Deno.makeTempDir({ prefix: "nix-repin-bun-test-" });
  const originalOutput = Deno.Command.prototype.output;
  const encoder = new TextEncoder();
  const responses = [
    {
      code: 0,
      success: true,
      stdout: encoder.encode(derivation),
      stderr: new Uint8Array(),
    },
    {
      code: 1,
      success: false,
      stdout: new Uint8Array(),
      stderr: encoder.encode(stderr),
    },
  ];
  Deno.Command.prototype.output = () =>
    Promise.resolve({
      ...responses.shift()!,
      signal: null,
    });

  try {
    await Deno.writeTextFile(`${directory}/flake.nix`, "{}");
    const definition = defineSource(
      provider((source) => {
        source.setNixSource(
          "/tmp/source",
          { version: "1.0.0" },
          (attributes) => JSON.stringify(attributes),
        );
      }),
      lock(),
    );
    return await definition({ packageDirectory: directory });
  } finally {
    Deno.Command.prototype.output = originalOutput;
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("bun.lock writes the dependency derivation's actual hash", async () => {
  const files = await generate(
    `error: hash mismatch in fixed-output derivation '${derivation}':
       specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
            got: ${hash}`,
  );
  deepStrictEqual(JSON.parse(files["source.nix"] as string), {
    version: "1.0.0",
    bunDepsHash: hash,
  });
});

Deno.test("bun.lock propagates failures from other dependencies", async () => {
  await rejects(
    generate(
      `error: hash mismatch in fixed-output derivation '/nix/store/other-source.drv':\n got: ${hash}`,
    ),
    /other-source\.drv/,
  );
  await rejects(generate("error: download failed"), /download failed/);
});
