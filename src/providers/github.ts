import { Octokit } from "octokit";

import * as nix from "../nix.ts";
import {
  provider,
  type SourceDefinition,
  type SourceFiles,
} from "../source.ts";
import { template } from "../template.ts";
import { fetchurl } from "./fetchurl.ts";

const octokit = new Octokit({
  auth: Deno.env.get("GITHUB_TOKEN") ?? Deno.env.get("GH_TOKEN"),
  userAgent: "nix-repin",
});

interface CommonOptions {
  files?: string[];
  repository: string;
}

interface BranchOptions extends CommonOptions {
  branch: string;
}

interface ReleaseOptions extends CommonOptions {
  assets?: Record<string, string>;
  includePrerelease?: boolean;
  stripPrefix?: string;
}

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

function additionalFiles(
  owner: string,
  repository: string,
  revision: string,
  options: CommonOptions,
): SourceFiles {
  return options.files
    ? rawFiles(owner, repository, revision, options.files)
    : {};
}

interface ArchiveSource {
  hash: string;
  sourceTree: string;
  url: string;
}

async function archiveSource(
  owner: string,
  repository: string,
  revision: string,
): Promise<ArchiveSource> {
  const url =
    `https://codeload.github.com/${owner}/${repository}/tar.gz/${revision}`;
  const { hash, storePath } = await nix.prefetch(url, { unpack: true });

  return { hash, sourceTree: storePath, url };
}

function archiveSourceNix(
  source: ArchiveSource,
  attributes: Record<string, string>,
): string {
  return nix.renderSource(
    ["fetchzip"],
    attributes,
    `  src = fetchzip {
    url = ${nix.string(source.url)};
    hash = ${nix.string(source.hash)};
    extension = "tar.gz";
  };`,
  );
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
  return provider(async (source) => {
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
      source.addFiles(await fetchurl({ urls, version }));
    } else {
      const archive = await archiveSource(owner, repository, tag);
      source.setNixSource(
        archive.sourceTree,
        { version, rev: tag },
        (attributes) => archiveSourceNix(archive, attributes),
      );
    }

    source.addFiles(additionalFiles(owner, repository, tag, options));
  });
}

export function branch(options: BranchOptions): SourceDefinition {
  return provider(async (source) => {
    const [owner, repository] = parseRepository(options.repository);
    const { data: commit } = await octokit.rest.repos.getCommit({
      owner,
      ref: options.branch,
      repo: repository,
    });
    const date = commit.commit.committer!.date!.slice(0, 10);

    const archive = await archiveSource(owner, repository, commit.sha);
    source.setNixSource(
      archive.sourceTree,
      { date, rev: commit.sha },
      (attributes) => archiveSourceNix(archive, attributes),
    );
    source.addFiles(additionalFiles(owner, repository, commit.sha, options));
  });
}
