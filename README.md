# nix-repin

`nix-repin` updates Nix package sources from TypeScript definitions. Define each
package in `pkgs/<name>/source.ts`. Generated files are written beside it.

## Usage

```sh
# Update all packages with a pkgs/*/source.ts definition
nix-repin

# Update selected packages
nix-repin xwayland-satellite yanhekt-autoslides

# Use another package directory
nix-repin --packages-root /path/to/repository/pkgs
```

Set `GITHUB_TOKEN` or `GH_TOKEN` to authenticate GitHub requests.

## Providers

### GitHub

Track the release archive with the highest version:

```ts
import { github } from "nix-repin";

export default github.release({
  repository: "owner/repository",
  stripPrefix: "v",
});
```

`github.release` selects published releases, excluding prereleases unless
`includePrerelease: true` is set. After removing `stripPrefix`, tags are sorted
by SemVer: a stable version ranks above its `alpha`, `beta`, and `rc` versions.
If any matching tag cannot be parsed as SemVer, the selection uses Nix's
`builtins.compareVersions` for all candidates. Release dates do not affect
sorting.

Use `github.tag` to select from repository tags, including repositories without
releases:

```ts
export default github.tag({
  repository: "owner/repository",
  tagPattern: "v[0-9]+\\.[0-9]+\\.[0-9]+",
  stripPrefix: "v",
});
```

Both providers accept `tagPattern`, a regular expression matched against the
whole tag before sorting. Omit it to consider all tags. `github.tag` has no
release metadata; use the pattern to exclude preview tags. `stripPrefix` removes
the given prefix from the selected tag's version and fails if it is absent.

To download release assets, map Nix systems to filename patterns:

```ts
export default github.release({
  assets: {
    "aarch64-linux": "program-{version}-linux-arm64\\.tar\\.gz",
    "x86_64-linux": "program-{version}-linux-x64\\.tar\\.gz",
  },
  repository: "owner/repository",
  stripPrefix: "v",
});
```

Patterns are regular expressions matched against the whole filename. The
`{version}`, `{tag}`, and `{system}` placeholders are substituted literally. Use
`default` for a platform-independent asset.

Track a branch and copy files from the resolved revision:

```ts
export default github.branch({
  branch: "main",
  files: ["path/to/file"],
  repository: "owner/repository",
});
```

Omit `branch` to use the repository's default branch. Set `before` to an ISO
8601 timestamp to select the newest commit before that time.

### npm

Track an npm package's `latest` tag:

```ts
import { npm } from "nix-repin";

export default npm.pkg({
  name: "@scope/program",
});
```

This generates `package.json`, `package-lock.json`, and a `source.nix` exporting
`version` and `npmDepsHash`. Set `distTag` to track another tag or `registry` to
use another registry.

### AUR

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

The provider removes the Arch epoch and package release suffix from the version.
URLs support `{version}` and `{system}` placeholders. Use Nix system names for
platform-specific downloads or `default` for a shared source.

### VS Code extensions

Download a VSIX from Open VSX:

```ts
import { openvsx } from "nix-repin";

export default openvsx.extension({
  namespace: "vscjava",
  name: "vscode-gradle",
});
```

The Open VSX provider supports only universal builds. It selects the newest
stable build and generates `source.nix` with `version` and `src`.

For Visual Studio Marketplace, map Nix systems to extension platforms:

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

The Marketplace provider selects the newest stable version available for every
requested platform. Omit `platforms` for a universal extension. Both providers
accept `includePrerelease: true` to include previews.

## Composing providers

`defineSource` runs providers in order, sharing one archive and its generated
files. For example, add `npmDepsHash` to a GitHub source:

```ts
import { defineSource, github, npm } from "nix-repin";

export default defineSource(
  github.release({ repository: "owner/repository", stripPrefix: "v" }),
  npm.lock("app/package-lock.json"),
);
```

If a GitHub archive's `rev` matches the existing `source.nix`, the entire
`defineSource` update is skipped, including later providers and file downloads.
Remove `source.nix` to regenerate it at the same revision. `npm.pkg` also skips
the entire update when the package version is unchanged.

These lock providers need an archive source. Place them after `github.branch`,
`github.tag`, or `github.release` without `assets`. File paths are relative to
the archive root.

| Provider                                  | Output                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm.lock("package-lock.json")`           | Adds `npmDepsHash` to `source.nix`.                                                         |
| `cargo.lock("Cargo.lock")`                | Copies the lock file and writes `cargo-lock.nix` with `outputHashes` for Git dependencies.  |
| `pubspec.lock({ flutter: "flutter347" })` | Resolves Flutter dependencies and writes `pubspec.lock.json` for `buildFlutterApplication`. |

For Flutter, `flutter` names an SDK attribute in the repository flake's
`nixpkgs` input. It must match the `flutter` argument in the package's
`default.nix`.

Import the generated Cargo lock settings in the package:

```nix
cargoDeps = rustPlatform.importCargoLock (import ./cargo-lock.nix);
```

## Custom sources

For other upstreams, pass a function to `defineSource`. Use `fetchurl` to
generate `source.nix` from a version and download URLs. Missing hashes are
calculated automatically.

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

The function can also return a map of relative file paths to text, `Uint8Array`
contents, or `URL` objects to download.

Use `provider` for a custom function that needs the shared `Source`. Return
`false` from that function to skip the entire update and discard collected
output.

### Reusable tools

Import these tools from `nix-repin` to fetch source data or generate custom
files:

| Tool                                                    | Result                                                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `github.latestCommit({ repository, branch?, before? })` | Commit `rev` and `date` (`YYYY-MM-DD`); defaults to the repository's default branch.                           |
| `github.prefetchArchive(repository, revision)`          | Unpacked archive `storePath`, `url`, and Nix `hash`.                                                           |
| `npm.writeLock(directory, options?)`                    | Writes `package-lock.json` from the directory's `package.json`, without running scripts or installing modules. |
| `npm.hash(lockPath)`                                    | Calculates `npmDepsHash` from an existing lock file.                                                           |
| `nix.prefetch(url, { unpack?, name? })`                 | Download `hash` and `storePath`.                                                                               |
| `nix.prefetchGit(url, revision)`                        | Nix hash for a Git checkout.                                                                                   |
| `runCommand(program, args, { cwd?, env? })`             | Trimmed stdout; throws with command output on failure.                                                         |

`before` is an ISO 8601 timestamp. For `npm.writeLock`, it limits both the
package and dependency versions. The other options are `registry` and
`legacyPeerDeps` (ignore peer dependencies).

Create `package.json` before calling `npm.writeLock`. Check or edit the
generated lock file before passing it to `npm.hash`. The caller owns the
directory and must clean up temporary files, including npm's cache at
`directory/cache`.

See [nix.ts](src/nix.ts) for Nix rendering and nixpkgs build helpers, and
[mod.ts](src/mod.ts) for all exports and types.

## License

[MIT](LICENSE). Made with ♥️ by [Ray](https://github.com/so1ve).
