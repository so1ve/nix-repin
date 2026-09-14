import * as path from "@std/path";

import { runCommand } from "../command.ts";
import { copyTree } from "../files.ts";
import * as nix from "../nix.ts";
import {
  provider,
  type SourceDefinition,
  type SourceFiles,
} from "../source.ts";

export interface LockOptions {
  /** nixpkgs attribute providing the Flutter SDK, for example flutter347. */
  flutter: string;
}

/** Resolve pubspec.lock from an archive source and generate pubspec.lock.json. */
export function lock(options: LockOptions): SourceDefinition {
  return provider(async (source) => {
    const [sdk, yq] = await Promise.all([
      nix.buildNixpkgsPackage(source.packageDirectory, options.flutter),
      nix.buildNixpkgsPackage(source.packageDirectory, "yq-go"),
    ]);

    const directory = await Deno.makeTempDir({ prefix: "nix-repin-pubspec-" });
    try {
      const tree = path.join(directory, "source");
      const home = path.join(directory, "home");
      await copyTree(source.sourceFile("."), tree);
      await Deno.mkdir(home, { recursive: true });

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
      await Deno.remove(directory, { recursive: true });
    }
  });
}
