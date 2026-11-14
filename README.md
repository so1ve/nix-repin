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

## Composing providers

`defineSource` runs providers in order. Add a dependency hash after its source:

```ts
import { defineSource, github, npm } from "nix-repin";

export default defineSource(
  github.release({ repository: "owner/repository", stripPrefix: "v" }),
  npm.lock("app/package-lock.json"),
);
```

Lock providers require `github.branch`, `github.tag`, `github.release` without
`assets`, or `git.branch` first. Paths are relative to that source.

Unchanged GitHub archives and Git checkouts skip the remaining providers. Set
`refresh: true` on a GitHub archive provider to force regeneration.

| Provider                                  | Output                          |
| ----------------------------------------- | ------------------------------- |
| `npm.lock("package-lock.json")`           | `npmDepsHash`                   |
| `bun.lock()`                              | `bunDepsHash`                   |
| `go.lock()`                               | `vendorHash`                    |
| `pnpm.lock()`                             | `pnpmDepsHash`                  |
| `cargo.lock("Cargo.lock")`                | `Cargo.lock`, `cargo-lock.nix`  |
| `pubspec.lock({ flutter: "flutter347" })` | `pubspec.lock.json` for Flutter |

<details>
<summary>Bun</summary>

```ts
import { bun, defineSource, github } from "nix-repin";

export default defineSource(
  github.branch({ repository: "owner/repository", refresh: true }),
  bun.lock(),
);
```

`default.nix` must accept `source` and expose a fixed-output `node_modules`
derivation with `outputHash = source.bunDepsHash`.

</details>

<details>
<summary>Go</summary>

```ts
import { defineSource, github, go } from "nix-repin";

export default defineSource(
  github.tag({ repository: "owner/repository", stripPrefix: "v" }),
  go.lock(),
);
```

`default.nix` must accept `source` and set `vendorHash = source.vendorHash` in
`buildGoModule`.

</details>

<details>
<summary>PNPM</summary>

```ts
import { defineSource, github, go, pnpm } from "nix-repin";

export default defineSource(
  github.release({ repository: "pocket-id/pocket-id", stripPrefix: "v" }),
  pnpm.lock("frontend.pnpmDeps"),
  go.lock(),
);
```

`default.nix` must accept `source` and use `source.pnpmDepsHash` for the
dependency hash. The attribute defaults to `pnpmDeps`.

</details>

<details>
<summary>Cargo</summary>

```nix
cargoDeps = rustPlatform.importCargoLock (import ./cargo-lock.nix);
```

</details>

<details>
<summary>Flutter</summary>

`flutter` names an SDK in the repository flake's `nixpkgs` input. It must match
the package's `flutter` argument.

</details>

## Custom sources

Use `fetchurl` for other upstreams. It calculates missing hashes:

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

Custom functions can also return `{ "relative/path": content }`, where content
is text, a `Uint8Array`, or a `URL` to download. Use `provider` to access the
shared `Source`; returning `false` skips the entire update and discards its
output.

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
