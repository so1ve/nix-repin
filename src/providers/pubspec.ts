import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { runCommand } from "../command.ts";
import { copyTree } from "../files.ts";
import * as nix from "../nix.ts";
import type { SourceDefinition, SourceFiles } from "../source.ts";

export interface LockOptions {
  /**
   * Nixpkgs attribute providing the Flutter SDK, for example flutter347.
   */
  flutter: string;
}

/**
 * Resolve pubspec.lock from an archive source and generate pubspec.lock.json.
 */
export const lock =
  (options: LockOptions): SourceDefinition =>
  async (source) => {
    const [sdk, yq] = await Promise.all([
      nix.buildNixpkgsPackage(source.packageDirectory, options.flutter),
      nix.buildNixpkgsPackage(source.packageDirectory, "yq-go"),
    ]);

    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "nix-repin-pubspec-"),
    );
    try {
      const tree = path.join(directory, "source");
      const home = path.join(directory, "home");
      await copyTree(source.sourceFile("."), tree);
      await fs.mkdir(home, { recursive: true });

      const environment = {
        HOME: home,
        PUB_CACHE: path.join(directory, "pub-cache"),
      };
      await runCommand(
        "nix",
        ["shell", sdk, "-c", "flutter", "--no-version-check", "pub", "get"],
        { cwd: tree, env: environment },
      );
      const contents = await runCommand(
        "nix",
        [
          "shell",
          yq,
          "-c",
          "yq",
          "--output-format=json",
          "--prettyPrint",
          "pubspec.lock",
        ],
        { cwd: tree },
      );

      return { "pubspec.lock.json": `${contents}\n` } satisfies SourceFiles;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
