import { Octokit } from "octokit";

import * as cargo from "../cargo.ts";
import * as nix from "../nix.ts";
import * as pubspec from "../pubspec.ts";
import type { SourceDefinition, SourceFiles } from "../source.ts";
import { template } from "../template.ts";
import { fetchurl } from "./fetchurl.ts";

const octokit = new Octokit({
  auth: Deno.env.get("GITHUB_TOKEN") ?? Deno.env.get("GH_TOKEN"),
  userAgent: "nix-repin",
});

interface CommonOptions {
  cargoLock?: string;
  files?: string[];
  repository: string;
}

/**
 * Flutter applications keep `pubspec.lock` out of the repository, so nix-repin
 * resolves it with the SDK named here and commits the JSON instead.
 */
interface PubspecOptions {
  /**
   * nixpkgs attribute providing the Flutter SDK that resolves `pubspec.lock`,
   * e.g. `flutter347`.
   */
  pubspecLock?: string;
}

interface BranchOptions extends CommonOptions, PubspecOptions {
  branch: string;
}

interface ReleaseBaseOptions extends CommonOptions, PubspecOptions {
  includePrerelease?: boolean;
  stripPrefix?: string;
}

/**
 * Release assets are prebuilt, so there is no source tree to resolve a pub lock
 * from: `pubspecLock` is only accepted for archive sources.
 */
export type ReleaseOptions =
  & ReleaseBaseOptions
  & (
    | { assets?: undefined }
    | { assets: Record<string, string>; pubspecLock?: never }
  );

function parseRepository(value: string): [owner: string, repository: string] {
  const [owner, name, extra] = value.split("/");
  if (!owner || !name || extra) {
    throw new Error(`repository must be owner/repo: ${value}`);
  }

  return [owner, name];
}

function rawFile(
  owner: string,
  repository: string,
  revision: string,
  path: string,
): URL {
  return new URL(
    `https://raw.githubusercontent.com/${
      [owner, repository, revision, ...path.split("/")]
        .map(encodeURIComponent)
        .join("/")
    }`,
  );
}

function rawFiles(
  owner: string,
  repository: string,
  revision: string,
  files: string[],
): SourceFiles {
  return Object.fromEntries(
    files.map((path) => [
      path,
      rawFile(owner, repository, revision, path),
    ]),
  );
}

async function additionalFiles(
  owner: string,
  repository: string,
  revision: string,
  options: CommonOptions,
): Promise<SourceFiles> {
  const files = options.files
    ? rawFiles(owner, repository, revision, options.files)
    : {};
  if (options.cargoLock) {
    Object.assign(
      files,
      await cargo.lockFile(
        options.cargoLock,
        rawFile(owner, repository, revision, options.cargoLock),
      ),
    );
  }

  return files;
}

interface ArchiveSource {
  sourceNix: string;
  sourceTree: string;
}

async function archiveSource(
  owner: string,
  repository: string,
  revision: string,
  attributes: Record<string, string>,
): Promise<ArchiveSource> {
  const url =
    `https://codeload.github.com/${owner}/${repository}/tar.gz/${revision}`;
  const { hash, storePath } = await nix.prefetch(url, { unpack: true });

  return {
    sourceTree: storePath,
    sourceNix: nix.renderSource(
      ["fetchzip"],
      { ...attributes, rev: revision },
      `  src = fetchzip {
    url = ${nix.string(url)};
    hash = ${nix.string(hash)};
    extension = "tar.gz";
  };`,
    ),
  };
}

async function pubspecFiles(
  flutter: string | undefined,
  packageDirectory: string,
  sourceTree: string,
): Promise<SourceFiles> {
  if (flutter === undefined) {
    return {};
  }

  const files = await pubspec.pubspecLock({
    flutter,
    packageDirectory,
    source: sourceTree,
  });

  return files;
}

async function latestRelease(
  owner: string,
  repository: string,
  includePrerelease: boolean,
) {
  if (!includePrerelease) {
    return (await octokit.rest.repos.getLatestRelease({
      owner,
      repo: repository,
    })).data;
  }

  const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner,
    per_page: 100,
    repo: repository,
  });
  const release = releases
    .filter((release) => !release.draft)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!release) {
    throw new Error(`${owner}/${repository}: no published release found`);
  }

  return release;
}

export function release(options: ReleaseOptions): SourceDefinition {
  return async ({ packageDirectory }) => {
    const [owner, repository] = parseRepository(options.repository);
    const release = await latestRelease(
      owner,
      repository,
      options.includePrerelease ?? false,
    );
    const tag = release.tag_name;
    let version = tag;
    if (options.stripPrefix) {
      if (!version.startsWith(options.stripPrefix)) {
        throw new Error(
          `${options.repository}: release tag ${version} does not start with ${options.stripPrefix}`,
        );
      }

      version = version.slice(options.stripPrefix.length);
    }
    let files: SourceFiles;
    if (options.assets) {
      const urls = Object.fromEntries(
        Object.entries(options.assets).map(([system, source]) => {
          const assetTemplate = template(source);
          const asset = release.assets.find((asset) =>
            assetTemplate.matches(asset.name, { version, tag, system })
          );
          if (!asset) {
            throw new Error(
              `${options.repository} release ${tag} has no asset matching ${source}`,
            );
          }
          const hash = asset.digest
            ? `sha256-${
              Uint8Array.fromHex(asset.digest.slice("sha256:".length))
                .toBase64()
            }`
            : undefined;

          return [system, { hash, url: asset.browser_download_url }];
        }),
      );
      files = await fetchurl({ urls, version });
    } else {
      const archive = await archiveSource(owner, repository, tag, { version });
      files = { "source.nix": archive.sourceNix };
      Object.assign(
        files,
        await pubspecFiles(
          options.pubspecLock,
          packageDirectory,
          archive.sourceTree,
        ),
      );
    }

    Object.assign(
      files,
      await additionalFiles(owner, repository, tag, options),
    );

    return files;
  };
}

export function branch(options: BranchOptions): SourceDefinition {
  return async ({ packageDirectory }) => {
    const [owner, repository] = parseRepository(options.repository);
    const { data: commit } = await octokit.rest.repos.getCommit({
      owner,
      ref: options.branch,
      repo: repository,
    });
    const date = commit.commit.committer!.date!.slice(0, 10);

    const archive = await archiveSource(owner, repository, commit.sha, {
      date,
    });
    const files: SourceFiles = { "source.nix": archive.sourceNix };
    Object.assign(
      files,
      await additionalFiles(owner, repository, commit.sha, options),
    );
    Object.assign(
      files,
      await pubspecFiles(
        options.pubspecLock,
        packageDirectory,
        archive.sourceTree,
      ),
    );

    return files;
  };
}
