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

Set `includePrerelease` to consider prereleases as well as stable releases when
selecting the most recently created release:

```ts
export default github.release({
  includePrerelease: true,
  repository: "owner/repository",
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

The generated `source.nix` exports `version` and `npmDepsHash`. The repository
also receives a minimal `package.json` and its fully resolved lock file. Use
`distTag` to track a tag other than `latest`, or `registry` for another npm
registry.

## AUR

Use an AUR package's upstream version to fill download URL templates:

```ts
import { aur } from "nix-repin";

export default aur.pkg({
  name: "baidunetdisk-bin",
  urls: {
    default:
      "https://pkg-ant.baidu.com/issue/netdisk/LinuxGuanjia/{version}/baidunetdisk_{version}_amd64.deb",
  },
});
```

The provider queries the AUR RPC API, removes the Arch epoch and package release
suffix, and substitutes `{version}` and `{system}` in each URL. Use Nix system
names for platform-specific downloads or `default` for a shared source.

## VSIX (Open VSX)

Track an extension's VSIX from the Open VSX registry:

```ts
import { openvsx } from "nix-repin";

export default openvsx.extension({
  namespace: "vscjava",
  name: "vscode-gradle",
});
```

The provider resolves a versioned VSIX download, calculates its hash, and
generates `source.nix` with `version` and `src`. It selects the newest stable
universal build, including when newer previews precede it. Set
`includePrerelease: true` to include previews. Extensions that publish only
platform-specific builds are not supported.

```nix
src = source.src.overrideAttrs {
  name = "gradle-language-server-${source.version}.zip";
};
```

## VSIX (Visual Studio Marketplace)

Track a Marketplace extension and map Nix systems to its target platforms:

```ts
import { marketplace } from "nix-repin";

export default marketplace.extension({
  publisher: "JetBrains",
  name: "kotlin-server",
  platforms: {
    "x86_64-linux": "linux-x64",
    "aarch64-linux": "linux-arm64",
  },
});
```

The provider selects the newest stable version available for every requested
platform, so all generated sources use the same version. Omit `platforms` for a
universal extension, or set `includePrerelease: true` to include previews.

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

## License

[MIT](LICENSE). Made with ♥️ by [Ray](https://github.com/so1ve).
