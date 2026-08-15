# nix-repin

`nix-repin` is an extensible source updater for Nix packages. Define a
`source.ts` and `nix-repin` will generate a `source.nix` for you.

## Usage

Update every package containing `pkgs/*/source.ts`:

```console
nix-repin
```

Update selected packages:

```console
nix-repin xwayland-satellite yanhekt-autoslides
```

Use another package directory:

```console
nix-repin --packages-root /path/to/repository/pkgs
```

Set `GITHUB_TOKEN` or `GH_TOKEN` to authenticate GitHub requests.

## GitHub

Track the latest release archive:

```ts
import { github } from "nix-repin";

export default github.release({
  repository: "owner/repository",
  stripPrefix: "v",
});
```

Select release assets by Nix system:

```ts
export default github.release({
  assets: {
    "aarch64-linux": "program-{version}-linux-arm64.tar.gz",
    "x86_64-linux": "program-{version}-linux-x64.tar.gz",
  },
  repository: "owner/repository",
  stripPrefix: "v",
});
```

Asset templates support `{version}`, `{tag}`, and `{system}`. Use `default` for
a platform-independent asset.

Track a branch and copy files from the resolved revision:

```ts
export default github.branch({
  branch: "main",
  files: ["path/to/file"],
  repository: "owner/repository",
});
```

Use `cargoLock` to copy a Cargo lock file and generate the `outputHashes`
required by Nix for Git dependencies:

```ts
export default github.branch({
  branch: "main",
  cargoLock: "Cargo.lock",
  repository: "owner/repository",
});
```

Use the generated file in the package:

```nix
cargoDeps = rustPlatform.importCargoLock (import ./cargo-lock.nix);
```

## NPM

Track the latest published version of an npm package and generate a minimal
`package.json`, complete `package-lock.json`, and matching `npmDepsHash`:

```ts
import { npm } from "nix-repin";

export default npm.pkg({
  name: "@scope/program",
});
```

## Custom sources

Pass a function, which may be asynchronous, to `defineSource` when an upstream
uses its own update manifest or download service. Return `fetchurl(...)` with
the resolved version and URLs; `nix-repin` calculates missing hashes.

```ts
import { defineSource, fetchurl } from "nix-repin";

export default defineSource(async () => {
  const response = await fetch("https://example.com/latest.json");
  const release = await response.json() as {
    downloads: Record<string, string>;
    version: string;
  };

  return fetchurl({
    urls: release.downloads,
    version: release.version,
  });
});
```

The generated `source.nix` exports `version` and `npmDepsHash`. The repository
also receives a minimal `package.json` and its fully resolved lock file. Use
`distTag` to track a tag other than `latest`, or `registry` for another npm
registry.

## License

[MIT](LICENSE). Made with ♥️ by [Ray](https://github.com/so1ve).
