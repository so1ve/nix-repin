import { deepStrictEqual } from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";

import { tempDir } from "../files.ts";
import { generateSource, withCommands } from "../test-support.ts";
import { fetchurl } from "./fetchurl.ts";

test("fetchurl reuses hashes from existing generated files unless forced or changed", async () => {
  await using tmp = await tempDir("nix-repin-fetchurl-reuse-");
  const prefetched: string[] = [];

  await withCommands(
    (program, args) => {
      if (program === "nix" && args[0] === "eval") {
        return undefined;
      }
      const url = args.at(-1)!;
      prefetched.push(url);

      return {
        stdout: JSON.stringify({
          hash: `sha256-fetched-${prefetched.length}`,
          storePath: `/nix/store/test-${prefetched.length}`,
        }),
      };
    },
    async () => {
      const initial = await generateSource(
        () =>
          fetchurl({
            version: "1.0.0",
            urls: {
              "x86_64-linux": {
                name: "app.tar.gz",
                url: "https://example.invalid/1.0.0-a/x64.tar.gz",
              },
              "aarch64-linux": {
                name: "app.tar.gz",
                url: "https://example.invalid/1.0.0-a/arm64.tar.gz",
              },
            },
          }),
        tmp.path,
      );
      deepStrictEqual(prefetched, [
        "https://example.invalid/1.0.0-a/x64.tar.gz",
        "https://example.invalid/1.0.0-a/arm64.tar.gz",
      ]);
      await fs.writeFile(
        `${tmp.path}/source.nix`,
        initial["source.nix"] as string,
      );

      // Identical URLs and names reuse existing hashes without prefetching.
      prefetched.length = 0;
      const unchanged = await generateSource(
        async () =>
          fetchurl({
            version: "1.0.0",
            urls: {
              "x86_64-linux": {
                name: "app.tar.gz",
                url: "https://example.invalid/1.0.0-a/x64.tar.gz",
              },
              "aarch64-linux": {
                name: "app.tar.gz",
                url: "https://example.invalid/1.0.0-a/arm64.tar.gz",
              },
            },
          }),
        tmp.path,
      );
      deepStrictEqual(prefetched, []);
      deepStrictEqual(unchanged, initial);

      // Only the changed URL is prefetched; the unchanged one reuses its hash.
      const partial = await generateSource(
        fetchurl({
          version: "1.0.0",
          urls: {
            "x86_64-linux": {
              name: "app.tar.gz",
              url: "https://example.invalid/1.0.0-b/x64.tar.gz",
            },
            "aarch64-linux": {
              name: "app.tar.gz",
              url: "https://example.invalid/1.0.0-a/arm64.tar.gz",
            },
          },
        }),
        tmp.path,
      );
      deepStrictEqual(prefetched, [
        "https://example.invalid/1.0.0-b/x64.tar.gz",
      ]);
      deepStrictEqual(
        (partial["source.nix"] as string).includes("sha256-fetched-2"),
        true,
      );

      // Forced updates ignore cached hashes and prefetch all URLs again.
      prefetched.length = 0;
      await generateSource(
        fetchurl({
          version: "1.0.0",
          urls: {
            "x86_64-linux": {
              name: "app.tar.gz",
              url: "https://example.invalid/1.0.0-a/x64.tar.gz",
            },
            "aarch64-linux": {
              name: "app.tar.gz",
              url: "https://example.invalid/1.0.0-a/arm64.tar.gz",
            },
          },
        }),
        tmp.path,
        true,
      );
      deepStrictEqual(prefetched, [
        "https://example.invalid/1.0.0-a/x64.tar.gz",
        "https://example.invalid/1.0.0-a/arm64.tar.gz",
      ]);
    },
  );
});

test("fetchurl supports custom output filenames and single-URL reuse", async () => {
  await using tmp = await tempDir("nix-repin-fetchurl-file-");
  const prefetched: string[] = [];

  await withCommands(
    (program, args) => {
      if (program === "nix" && args[0] === "eval") {
        return undefined;
      }
      prefetched.push(args.at(-1)!);

      return {
        stdout: JSON.stringify({
          hash: "sha256-single",
          storePath: "/nix/store/test-single",
        }),
      };
    },
    async () => {
      const first = await generateSource(
        fetchurl({
          file: "frida.nix",
          version: "2.0.0",
          urls: { default: "https://example.invalid/2.0.0.tar.gz" },
        }),
        tmp.path,
      );
      deepStrictEqual(Object.keys(first), ["frida.nix"]);
      deepStrictEqual(prefetched, ["https://example.invalid/2.0.0.tar.gz"]);
      await fs.writeFile(`${tmp.path}/frida.nix`, first["frida.nix"] as string);

      prefetched.length = 0;
      const second = await generateSource(
        fetchurl({
          file: "frida.nix",
          version: "2.0.0",
          urls: { default: "https://example.invalid/2.0.0.tar.gz" },
        }),
        tmp.path,
      );
      deepStrictEqual(prefetched, []);
      deepStrictEqual(second, first);
    },
  );
});
