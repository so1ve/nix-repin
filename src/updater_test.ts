import { deepStrictEqual } from "node:assert/strict";

import * as nix from "./nix.ts";
import { withCommands } from "./test_support.ts";
import { updatePackages } from "./updater.ts";

Deno.test("updates skip unchanged Git sources unless forced at the entry point", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "nix-repin-update-test-",
  });
  const packageDirectory = `${directory}/program`;
  const rev = "0123456789abcdef";
  const gitModule = new URL("./providers/git.ts", import.meta.url).href;
  const sourceModule = new URL("./source.ts", import.meta.url).href;
  try {
    await Deno.mkdir(packageDirectory);
    await Deno.writeTextFile(
      `${packageDirectory}/source.ts`,
      `
import { branch } from ${JSON.stringify(gitModule)};
import { defineSource } from ${JSON.stringify(sourceModule)};
export default defineSource(
  branch({ url: "https://git.example/program.git" }),
  () => ({ "dependencies.txt": "regenerated" }),
);
`,
    );
    const previous = nix.renderSource([], { rev }, "  src = null;");
    await Deno.writeTextFile(`${packageDirectory}/source.nix`, previous);
    await Deno.writeTextFile(
      `${packageDirectory}/dependencies.txt`,
      "previous",
    );

    await withCommands((program) => {
      if (program === "git") return { stdout: `${rev}\tHEAD` };
      deepStrictEqual(program, "nix-prefetch-git");
      return {
        stdout: JSON.stringify({
          rev,
          date: "2026-01-01T00:00:00Z",
          hash: "sha256-Bta1tf1e34LoaOYhd/iN48LkCM7/jfTN4GHKHmi6758=",
          path: directory,
        }),
      };
    }, async () => {
      await updatePackages(directory, []);
      deepStrictEqual(
        await Deno.readTextFile(`${packageDirectory}/dependencies.txt`),
        "previous",
      );
      deepStrictEqual(
        await Deno.readTextFile(`${packageDirectory}/source.nix`),
        previous,
      );

      await updatePackages(directory, ["program"], { force: true });
      deepStrictEqual(
        await Deno.readTextFile(`${packageDirectory}/dependencies.txt`),
        "regenerated",
      );
      const updated = await Deno.readTextFile(`${packageDirectory}/source.nix`);
      deepStrictEqual(updated.includes(`rev = "${rev}";`), true);
      deepStrictEqual(updated.includes("fetchgit"), true);
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
