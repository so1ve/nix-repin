# nix-repin

`nix-repin` updates Nix package sources from TypeScript definitions. Each
package has a `source.ts` that describes where to get its source and which
dependency hashes it needs. Generated files are written beside it for use in
your Nix package definition.

## Usage

Create `pkgs/program/source.ts` and export a provider. For example, to follow a
GitHub repository's highest stable release:

```ts
import { github } from "nix-repin";

export default github.release({
  repository: "owner/repository",
  stripPrefix: "v",
});
```

Run the updater from your repository root:

```sh
nix-repin program
```

This writes `pkgs/program/source.nix` with `version`, `rev`, and `src`. Load it
with `pkgs.callPackage ./pkgs/program/source.nix { }` and use its `version` and
`src` in your package derivation. Set `GITHUB_TOKEN` or `GH_TOKEN` to
authenticate GitHub requests.

You can also update several packages at once or use a different package
directory:

```sh
# Update all packages with a pkgs/*/source.ts definition
nix-repin

# Update selected packages
nix-repin xwayland-satellite yanhekt-autoslides

# Use another package directory
nix-repin --packages-root /path/to/repository/pkgs
```

If the package also needs a dependency hash, add another step with
`defineSource`:

```ts
import { defineSource, github, npm } from "nix-repin";

export default defineSource(
  github.release({ repository: "owner/repository", stripPrefix: "v" }),
  npm.lock({ path: "app/package-lock.json" }),
);
```

`defineSource` runs the providers in order and shares their source tree and
generated output. Here, `github.release` fetches the source, then `npm.lock`
reads `app/package-lock.json` from it and adds `npmDepsHash` to `source.nix`.

Git, GitHub archive, and npm providers skip the update when their tracked
revision or version is unchanged. After changing `source.ts` or the dependency
setup in `default.nix`, force regeneration for that run:

```sh
nix-repin --force program
```

## Providers

### Sources

Choose a provider for the upstream you want to track. It can be exported
directly from `source.ts`, as in the first example, or used first in
`defineSource`.

<details>
<summary>GitHub</summary>

Track the highest stable release:

```ts
import { github } from "nix-repin";

export default github.release({
  repository: "owner/repository",
  stripPrefix: "v",
});
```

Set `includePrerelease: true` to include previews.

Select repository tags:

```ts
export default github.tag({
  repository: "owner/repository",
  tagPattern: "v[0-9]+\\.[0-9]+\\.[0-9]+",
  stripPrefix: "v",
});
```

`tagPattern` matches whole tags; `stripPrefix` removes the prefix from
`version`.

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

Asset regexes match whole filenames and support `{version}`, `{tag}`, and
`{system}`. Use `default` for a shared asset.

Track a branch and copy files:

```ts
export default github.branch({
  branch: "main",
  files: ["path/to/file"],
  repository: "owner/repository",
});
```

Omit `branch` to follow the default branch. `before` selects commits before an
ISO 8601 timestamp. All three providers accept `files`.

</details>

<details>
<summary>Git</summary>

```ts
import { git } from "nix-repin";

export default git.branch({
  url: "https://codeberg.org/owner/repository.git",
  branch: "main",
});
```

Generates `rev`, `date`, and a `fetchgit` source without submodules. Omit
`branch` to follow `HEAD`.

</details>

<details>
<summary>OCI container images</summary>

Follow a tag and pin the image by digest:

```ts
import { oci } from "nix-repin";

export default oci.tag({
  repository: "docker.io/library/traefik",
  tag: "v3",
});
```

Use `oci.image` to select the highest matching version:

```ts
export default oci.image({
  repository: "docker.io/library/traefik",
  tagPattern: "v3\\.[0-9]+\\.[0-9]+",
  stripPrefix: "v",
});
```

To keep container definitions in a separate directory, save this as
`images/traefik/source.ts` and run:

```sh
nix-repin --packages-root images
```

Import the generated `repository:tag@digest` reference:

```nix
Image = (import ./images/traefik/source.nix).image;
```

</details>

<details>
<summary>npm</summary>

```ts
import { npm } from "nix-repin";

export default npm.pkg({
  name: "@scope/program",
});
```

Generates `package.json`, `package-lock.json`, and `source.nix` with `version`
and `npmDepsHash`. `distTag` defaults to `latest`; `registry` overrides the
registry.

Use `npm.tarball` with the same options to generate a `fetchurl` source instead.

```ts
export default npm.tarball({ name: "@cnbcool/cnb-cli" });
```

</details>

<details>
<summary>AUR</summary>

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

`{version}` excludes the Arch epoch and package release suffix. URL keys are Nix
systems or `default`; URLs also accept `{system}`.

</details>

<details>
<summary>VS Code extensions</summary>

```ts
import { openvsx } from "nix-repin";

export default openvsx.extension({
  namespace: "vscjava",
  name: "vscode-gradle",
});
```

Open VSX supports universal builds. For platform-specific builds, use
Marketplace:

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

Both generate `version` and `src` for the newest stable release available on all
requested platforms. Set `includePrerelease: true` for previews. Marketplace
defaults to universal when `platforms` is omitted.

</details>

### Dependencies

Add dependency providers after `github.branch`, `github.tag`, `github.release`
without `assets`, or `git.branch` in `defineSource`. Each ecosystem exposes
`.lock(options)`; omit the options to use the defaults. Flutter requires an SDK
selection that matches your package.

| Provider                                  | Generated output               |
| ----------------------------------------- | ------------------------------ |
| `npm.lock()`                              | `npmDepsHash` in `source.nix`  |
| `bun.lock()`                              | `bunDepsHash` in `source.nix`  |
| `go.lock()`                               | `vendorHash` in `source.nix`   |
| `pnpm.lock()`                             | `pnpmDepsHash` in `source.nix` |
| `yarn.lock()`                             | `yarnDepsHash` in `source.nix` |
| `cargo.lock()`                            | `Cargo.lock`, `cargo-lock.nix` |
| `pubspec.lock({ flutter: "flutter347" })` | `pubspec.lock.json`            |

npm and Cargo read lock files from the fetched source tree. Their `path` option
defaults to `package-lock.json` and `Cargo.lock`, respectively:

```ts
npm.lock({ path: "app/package-lock.json" });
cargo.lock({ path: "backend/Cargo.lock" });
```

Bun, Go, PNPM, and Yarn build a dependency derivation from your package's
`default.nix`, using the enclosing flake's `nixpkgs` input. The package must
accept a `source` argument and use the generated hash as shown below. Toolchain
versions, fetcher options, and patches stay in `default.nix`.

<details>
<summary>Go</summary>

```ts
import { defineSource, github, go } from "nix-repin";

export default defineSource(
  github.release({ repository: "owner/repository", stripPrefix: "v" }),
  go.lock(),
);
```

Set `vendorHash = source.vendorHash` in `buildGoModule`. The provider builds the
package's `goModules` derivation to calculate that hash.

</details>

<details>
<summary>Bun</summary>

Use `bun.lock()` and expose a fixed-output `node_modules` derivation from
`default.nix` with `outputHash = source.bunDepsHash`.

</details>

<details>
<summary>PNPM and nested derivations</summary>

Use `pnpm.lock()` when `default.nix` exposes `pnpmDeps`. Use
`source.pnpmDepsHash` as that derivation's hash.

For a nested derivation, set `attribute` to its path in the value returned by
`default.nix`:

```ts
import { defineSource, github, go, pnpm } from "nix-repin";

export default defineSource(
  github.release({ repository: "pocket-id/pocket-id", stripPrefix: "v" }),
  pnpm.lock({ attribute: "frontend.pnpmDeps" }),
  go.lock(),
);
```

Bun, Go, and Yarn also accept `attribute` when your package exposes the
dependency derivation under a different name or path. The generated hash field
stays the same.

</details>

<details>
<summary>Yarn</summary>

```ts
import { defineSource, github, yarn } from "nix-repin";

export default defineSource(
  github.release({ repository: "owner/repository", stripPrefix: "v" }),
  yarn.lock(),
);
```

Expose the offline cache from `default.nix` and use `source.yarnDepsHash`:

```nix
yarnOfflineCache = fetchYarnDeps {
  yarnLock = source.src + "/yarn.lock";
  hash = source.yarnDepsHash;
};
```

This also works with `fetchYarnBerryDeps`. For a package that exposes its cache
as `offlineCache`, use `yarn.lock({ attribute: "offlineCache" })`. Any required
Yarn Berry `missingHashes` file must be supplied by the package definition; this
provider updates the cache hash. See the
[Nixpkgs Yarn documentation](https://nixos.org/manual/nixpkgs/unstable/#javascript-yarn-v1)
for package setup.

</details>

<details>
<summary>Cargo</summary>

`cargo.lock()` copies the upstream `Cargo.lock` and generates `cargo-lock.nix`
with hashes for Git dependencies. Use the generated files in your Rust
derivation:

```nix
cargoDeps = rustPlatform.importCargoLock (import ./cargo-lock.nix);
```

</details>

<details>
<summary>Flutter</summary>

`pubspec.lock({ flutter: "flutter347" })` runs `flutter pub get` in a copy of
the source tree and converts the resulting lock file to `pubspec.lock.json`. Its
`flutter` option selects an SDK from the repository flake's `nixpkgs` input and
must match the package's `flutter` argument.

</details>

## Custom sources

When an upstream has no built-in provider, export an async function that returns
the files to write. For downloadable releases, `fetchurl` generates `source.nix`
from URLs and a version, calculating any missing hashes:

```ts
import { fetchurl } from "nix-repin";

export default async () => {
  const response = await fetch("https://example.com/latest.json");
  const release = await response.json() as {
    downloads: Record<string, string>;
    version: string;
  };

  return fetchurl({
    urls: release.downloads,
    version: release.version,
  });
};
```

The return value is a map of `{ "relative/path": content }`. Paths are relative
to the package directory; content can be text, a `Uint8Array`, or a `URL` to
download. These functions can also be combined with other providers through
`defineSource`.

Each function receives the shared `Source` as its argument. It can read files
from the fetched tree with `source.sourceFile(path)` or add Nix attributes with
`source.addNixAttribute(name, value)`. Returning `false` skips the entire update
and discards the output collected so far.

Use `source.matches({ rev })` to compare attributes with the existing generated
`source.nix`. It returns `true` when all supplied values match, and `false` if
the file or an attribute is missing. You can compare several attributes at once,
such as `source.matches({ rev, version })`.

To skip an unchanged update, use that comparison with `source.shouldSkip`:

```ts
if (await source.shouldSkip(() => source.matches({ rev }))) {
  return false;
}
```

With `--force`, `shouldSkip` returns `false` without running its check.
`matches` always reports the actual comparison result. For other stored output,
pass your own comparison function to `shouldSkip`.

The helpers below cover common tasks when writing a custom source.

<details>
<summary>Codeberg</summary>

```ts
import { codeberg } from "nix-repin";

const repository = "Koromix/rygel";
const { rev } = await codeberg.resolveRef(repository, "koffi/2.14.1");
const manifest = JSON.parse(
  await codeberg.readFile(repository, rev, "src/koffi/package.json"),
);
const archive = await codeberg.prefetchArchive(repository, rev);
```

`prefetchArchive` unpacks for `fetchzip`. Pass `{ unpack: false }` for
`fetchurl`.

</details>

<details>
<summary>Render an archive with a known hash</summary>

Use a revision and unpacked hash from a lock file:

```ts
import { github, nix } from "nix-repin";

const { owner, repo, rev, narHash } = lock.nodes["tree-sitter-nix"].locked;
const files = {
  "tree-sitter-nix.nix": nix.renderArchive(
    { url: github.archiveUrl(`${owner}/${repo}`, rev), hash: narHash },
    { rev },
  ),
};
```

`renderArchive` generates a `fetchzip` source without downloading it.
`github.archiveUrl` and `codeberg.archiveUrl` construct archive URLs.

</details>

<details>
<summary>Reusable tools</summary>

| Tool                                                    | Result                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `github.latestCommit({ repository, branch?, before? })` | `rev`, `date`; follows the default branch unless `branch` is set.                       |
| `github.prefetchArchive(repository, revision)`          | Unpacked `storePath`, `url`, `hash`.                                                    |
| `npm.writeLock(directory, options?)`                    | Writes `package-lock.json` from `package.json`, without scripts or module installation. |
| `npm.hash(lockPath)`                                    | `npmDepsHash`.                                                                          |
| `nix.prefetch(url, { unpack?, name? })`                 | `hash`, `storePath`.                                                                    |
| `nix.prefetchGit(url, revision)`                        | Git checkout hash.                                                                      |
| `nix.prefetchGitSource(url, revision)`                  | `rev`, `date`, `hash`, `storePath`; excludes submodules.                                |
| `copyTree(from, to)`                                    | Copies a tree, preserving symlinks and permissions and adding owner write access.       |
| `runCommand(program, args, { cwd?, env? })`             | Trimmed stdout; throws with command output on failure.                                  |

`npm.writeLock` accepts `registry`, `legacyPeerDeps`, and `before` (an ISO 8601
cutoff for package and dependency versions). Create `package.json` first; the
caller must clean up the directory, including `directory/cache`.

</details>

See [mod.ts](src/mod.ts) for exports and [nix.ts](src/nix.ts) for Nix helpers.

## License

[MIT](LICENSE). Made with ♥️ by [Ray](https://github.com/so1ve).
