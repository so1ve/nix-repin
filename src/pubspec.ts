import * as path from "@std/path";

import { runCommand } from "./command.ts";
import { copyTree } from "./files.ts";
import * as nix from "./nix.ts";
import type { SourceFiles } from "./source.ts";

interface Options {
  /**
   * nixpkgs attribute providing the Flutter SDK used to resolve the lock, e.g.
   * `flutter347`. It is resolved from the repository flake's `nixpkgs` input.
   */
  flutter: string;
  /** Package directory whose enclosing flake pins nixpkgs. */
  packageDirectory: string;
  /** Unpacked source tree containing `pubspec.yaml`. */
  source: string;
}

/**
 * Resolve the gitignored `pubspec.lock` of a Flutter application with its real
 * SDK and return it as the JSON `pubspec.lock.json` consumed by
 * `buildFlutterApplication`.
 */
export async function pubspecLock(
  { flutter, packageDirectory, source }: Options,
): Promise<SourceFiles> {
  const [sdk, yq] = await Promise.all([
    nix.buildNixpkgsPackage(packageDirectory, flutter),
    nix.buildNixpkgsPackage(packageDirectory, "yq-go"),
  ]);

  const directory = await Deno.makeTempDir({ prefix: "nix-repin-pubspec-" });
  try {
    const tree = path.join(directory, "source");
    const home = path.join(directory, "home");
    await copyTree(source, tree);
    await Deno.mkdir(home, { recursive: true });

    // Pub resolution needs a writable HOME and network access
    const environment = {
      HOME: home,
      PUB_CACHE: path.join(directory, "pub-cache"),
    };
    await runCommand(
      "nix",
      ["shell", sdk, "-c", "flutter", "--no-version-check", "pub", "get"],
      { cwd: tree, env: environment },
    );
    const lock = await runCommand(
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

    return { "pubspec.lock.json": `${lock}\n` };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
