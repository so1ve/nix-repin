import { deepStrictEqual } from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import * as nix from "./nix.ts";
import { withCommands } from "./test_support.ts";
import { updatePackages } from "./updater.ts";

test("updates skip unchanged Git sources unless forced at the entry point", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "nix-repin-update-test-"),
  );
  const packageDirectory = `${directory}/program`;
  const rev = "0123456789abcdef";
  try {
    await fs.mkdir(packageDirectory);
    await fs.writeFile(
      `${packageDirectory}/source.ts`,
      `
import { defineSource, git } from "nix-repin";
export default defineSource(
  git.branch({ url: "https://git.example/program.git" }),
  () => ({ "dependencies.txt": "regenerated" }),
);
`,
    );
    const previous = nix.renderSource([], { rev }, "  src = null;");
    await fs.writeFile(`${packageDirectory}/source.nix`, previous);
    await fs.writeFile(`${packageDirectory}/dependencies.txt`, "previous");

    await withCommands(
      (program) => {
        if (program === "git") {
          return { stdout: `${rev}\tHEAD` };
        }
        deepStrictEqual(program, "nix-prefetch-git");

        return {
          stdout: JSON.stringify({
            rev,
            date: "2026-01-01T00:00:00Z",
            hash: "sha256-Bta1tf1e34LoaOYhd/iN48LkCM7/jfTN4GHKHmi6758=",
            path: directory,
          }),
        };
      },
      async () => {
        await updatePackages(directory, []);
        deepStrictEqual(
          await fs.readFile(`${packageDirectory}/dependencies.txt`, "utf8"),
          "previous",
        );
        deepStrictEqual(
          await fs.readFile(`${packageDirectory}/source.nix`, "utf8"),
          previous,
        );

        await updatePackages(directory, ["program"], { force: true });
        deepStrictEqual(
          await fs.readFile(`${packageDirectory}/dependencies.txt`, "utf8"),
          "regenerated",
        );
        const updated = await fs.readFile(
          `${packageDirectory}/source.nix`,
          "utf8",
        );
        deepStrictEqual(updated.includes(`rev = "${rev}";`), true);
        deepStrictEqual(updated.includes("fetchgit"), true);
      },
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
