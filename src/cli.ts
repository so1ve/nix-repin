import { parseArgs } from "node:util";

import manifest from "../package.json" with { type: "json" };
import { updatePackages } from "./updater.ts";

try {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "force": { type: "boolean", default: false },
      "help": { type: "boolean", short: "h", default: false },
      "packages-root": { type: "string", default: "pkgs" },
      "version": { type: "boolean", short: "V", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`nix-repin ${manifest.version}

Update Nix package sources from TypeScript definitions.

Usage:
  nix-repin [options] [packages...]

Options:
  --packages-root <path>  Directory containing package definitions (default: pkgs)
  --force                Regenerate output even when the source is unchanged
  -h, --help              Show this help
  -V, --version           Show the version`);
  } else if (values.version) {
    console.log(manifest.version);
  } else {
    const packagesRoot = values["packages-root"];
    if (!packagesRoot) {
      throw new Error("--packages-root requires a value");
    }

    await updatePackages(packagesRoot, positionals, { force: values.force });
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
