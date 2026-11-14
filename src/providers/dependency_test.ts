import { deepStrictEqual, rejects } from "node:assert/strict";

import { defineSource, provider, type SourceDefinition } from "../source.ts";
import * as bun from "./bun.ts";
import * as go from "./go.ts";
import * as pnpm from "./pnpm.ts";

const derivation = "/nix/store/example-dependencies.drv";
const hash = "sha256-Bta1tf1e34LoaOYhd/iN48LkCM7/jfTN4GHKHmi6758=";

async function generate(lock: SourceDefinition, stderr: string) {
  const directory = await Deno.makeTempDir({
    prefix: "nix-repin-dependency-test-",
  });
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
      lock,
    );
    return await definition({ packageDirectory: directory });
  } finally {
    Deno.Command.prototype.output = originalOutput;
    await Deno.remove(directory, { recursive: true });
  }
}

for (
  const [name, lock, attribute] of [
    ["bun.lock", bun.lock(), "bunDepsHash"],
    ["go.lock", go.lock(), "vendorHash"],
    ["pnpm.lock", pnpm.lock("frontend.pnpmDeps"), "pnpmDepsHash"],
  ] as const
) {
  Deno.test(`${name} writes the dependency derivation's actual hash`, async () => {
    const files = await generate(
      lock,
      `error: hash mismatch in fixed-output derivation '${derivation}':
       specified: sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
            got: ${hash}`,
    );
    deepStrictEqual(JSON.parse(files["source.nix"] as string), {
      version: "1.0.0",
      [attribute]: hash,
    });
  });

  Deno.test(`${name} propagates failures from other dependencies`, async () => {
    await rejects(
      generate(
        lock,
        `error: hash mismatch in fixed-output derivation '/nix/store/other-source.drv':\n got: ${hash}`,
      ),
      /other-source\.drv/,
    );
    await rejects(generate(lock, "error: download failed"), /download failed/);
  });
}
