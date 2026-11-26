import { deepStrictEqual } from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";

import { tempDir } from "../files.ts";
import * as nix from "../nix.ts";
import { generateSource, withCommands } from "../test-support.ts";
import * as aur from "./aur.ts";
import * as marketplace from "./marketplace.ts";
import * as openvsx from "./openvsx.ts";

test("versioned download providers skip prefetching when source.nix matches", async () => {
  const version = "1.2.3";
  const cases = [
    {
      name: "aur",
      definition: aur.pkg({
        name: "example-bin",
        urls: { default: "https://example.invalid/{version}.deb" },
      }),
      response: {
        type: "multiinfo",
        results: [{ Name: "example-bin", Version: `1:${version}-2` }],
      },
    },
    {
      name: "openvsx",
      definition: openvsx.extension({ namespace: "ns", name: "ext" }),
      response: {
        totalSize: 1,
        extensions: [
          {
            version,
            preRelease: false,
            files: { download: "https://example.invalid/ext.vsix" },
          },
        ],
      },
    },
    {
      name: "marketplace",
      definition: marketplace.extension({ publisher: "pub", name: "ext" }),
      response: {
        results: [{ extensions: [{ versions: [{ version }] }] }],
      },
    },
  ];

  for (const entry of cases) {
    await using tmp = await tempDir(`nix-repin-${entry.name}-skip-`);
    await fs.writeFile(
      `${tmp.path}/source.nix`,
      nix.renderSource(["fetchurl"], { version }, "  src = null;"),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(Response.json(entry.response));
    try {
      await withCommands(
        (program, args) => {
          if (program === "nix" && args[0] === "eval") {
            return undefined;
          }

          throw new Error(`${entry.name}: must not prefetch unchanged version`);
        },
        async () => {
          deepStrictEqual(await generateSource(entry.definition, tmp.path), {});
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});
