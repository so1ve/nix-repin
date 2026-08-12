import { parseArgs } from "@std/cli/parse-args";

import manifest from "../deno.json" with { type: "json" };
import { updatePackages } from "./updater.ts";

try {
  const options = parseArgs(Deno.args, {
    alias: {
      help: "h",
      version: "V",
    },
    boolean: ["help", "version"],
    string: ["_", "packages-root"],
    default: {
      "packages-root": "pkgs",
    },
    unknown: (argument) => {
      if (argument.startsWith("-")) {
        throw new Error(`unknown option: ${argument}`);
      }

      return true;
    },
  });

  if (options.help) {
    console.log(`nix-repin ${manifest.version}

Update Nix package sources from TypeScript definitions.

Usage:
  nix-repin [options] [packages...]

Options:
  --packages-root <path>  Directory containing package definitions (default: pkgs)
  -h, --help              Show this help
  -V, --version           Show the version`);
  } else if (options.version) {
    console.log(manifest.version);
  } else {
    const packagesRoot = options["packages-root"];
    if (!packagesRoot) {
      throw new Error("--packages-root requires a value");
    }

    await updatePackages(
      packagesRoot,
      options._ as string[],
    );
  }
} catch (error) {
  console.error((error as Error).message);
  Deno.exit(1);
}
