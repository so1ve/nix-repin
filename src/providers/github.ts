import { Octokit } from "octokit";

import * as nix from "../nix.ts";
import type { Source, SourceDefinition, SourceFiles } from "../source.ts";
import { selectTag } from "../tags.ts";
import { template } from "../template.ts";
import { fetchurl } from "./fetchurl.ts";

/**
 * Pre-configured Octokit client using GITHUB_TOKEN or GH_TOKEN.
 */
export const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  userAgent: "nix-repin",
});

interface CommonOptions {
  files?: string[];
  repository: string;
}

export interface CommitOptions {
  repository: string;
  /**
   * Branch to track; defaults to the repository's default branch.
   */
  branch?: string;
  /**
   * Only consider commits before this ISO 8601 timestamp.
   */
  before?: string;
}

type BranchOptions = CommonOptions & CommitOptions;

interface TagOptions extends CommonOptions {
  /**
   * Regular expression matched against the whole tag.
   */
  tagPattern?: string;
  stripPrefix?: string;
}

interface ReleaseOptions extends TagOptions {
  assets?: Record<string, string>;
  includePrerelease?: boolean;
}

function parseRepository(value: string): [owner: string, repository: string] {
  const [owner, name, extra] = value.split("/");
  if (!owner || !name || extra) {
    throw new Error(`repository must be owner/repo: ${value}`);
  }

  return [owner, name];
}

const rawFile = (
  owner: string,
  repository: string,
  revision: string,
  path: string,
): URL =>
  new URL(
    `https://raw.githubusercontent.com/${[
      owner,
      repository,
      revision,
      ...path.split("/"),
    ]
      .map(encodeURIComponent)
      .join("/")}`,
  );

const rawFiles = (
  owner: string,
  repository: string,
  revision: string,
  files: string[],
): SourceFiles =>
  Object.fromEntries(
    files.map((path) => [path, rawFile(owner, repository, revision, path)]),
  );

const additionalFiles = (
  owner: string,
  repository: string,
  revision: string,
  options: CommonOptions,
): SourceFiles =>
  options.files ? rawFiles(owner, repository, revision, options.files) : {};

export interface ArchiveSource extends nix.PrefetchResult {
  url: string;
}

/**
 * Build the tar.gz URL for a GitHub revision without fetching it.
 */
export function archiveUrl(repository: string, revision: string): string {
  const [owner, name] = parseRepository(repository);

  return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(
    name,
  )}/tar.gz/${encodeURIComponent(revision)}`;
}

/**
 * Download and unpack a GitHub revision, returning its URL, hash and store
 * path.
 */
export async function prefetchArchive(
  repository: string,
  revision: string,
): Promise<ArchiveSource> {
  const url = archiveUrl(repository, revision);
  const { hash, storePath } = await nix.prefetch(url, { unpack: true });

  return { hash, storePath, url };
}

/**
 * Resolve a branch's newest commit, optionally bounded by a publication cutoff.
 */
export async function latestCommit(
  options: CommitOptions,
): Promise<{ rev: string; date: string }> {
  const [owner, repo] = parseRepository(options.repository);
  const { data: commits } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    sha: options.branch,
    until: options.before,
    per_page: 1,
  });
  const commit = commits[0];
  if (!commit) {
    throw new Error(
      `${options.repository}: no commit found${
        options.before ? ` before ${options.before}` : ""
      }`,
    );
  }

  return { rev: commit.sha, date: commit.commit.committer!.date!.slice(0, 10) };
}

async function archive(
  source: Source,
  options: CommonOptions,
  attributes: Record<string, string> & { rev: string },
): Promise<false | void> {
  if (await source.shouldSkip(() => source.matches({ rev: attributes.rev }))) {
    return false;
  }

  const fetched = await prefetchArchive(options.repository, attributes.rev);
  source.setNixSource(fetched.storePath, attributes, (attributes) =>
    nix.renderArchive(fetched, attributes),
  );
  const [owner, repository] = parseRepository(options.repository);
  source.addFiles(additionalFiles(owner, repository, attributes.rev, options));
}

/**
 * Track the highest matching tag, including repositories without releases.
 */
export const tag =
  (options: TagOptions): SourceDefinition =>
  async (source) => {
    const [owner, repo] = parseRepository(options.repository);
    const tags = await octokit.paginate(octokit.rest.repos.listTags, {
      owner,
      repo,
      per_page: 100,
    });
    const { tag, version } = await selectTag(
      tags.map((tag) => tag.name),
      options,
    );

    return archive(source, options, { version, rev: tag });
  };

export const release =
  (options: ReleaseOptions): SourceDefinition =>
  async (source) => {
    const [owner, repository] = parseRepository(options.repository);
    const releases = (
      await octokit.paginate(octokit.rest.repos.listReleases, {
        owner,
        repo: repository,
        per_page: 100,
      })
    ).filter(
      (release) =>
        !release.draft &&
        (Boolean(options.includePrerelease) || !release.prerelease),
    );
    const { tag, version } = await selectTag(
      releases.map((release) => release.tag_name),
      options,
    );
    const release = releases.find((release) => release.tag_name === tag)!;
    if (options.assets) {
      if (await source.shouldSkip(() => source.matches({ version }))) {
        return false;
      }

      const urls = Object.fromEntries(
        Object.entries(options.assets).map(([system, source]) => {
          const assetTemplate = template(source);
          const asset = release.assets.find((asset) =>
            assetTemplate.matches(asset.name, { version, tag, system }),
          );
          if (!asset) {
            throw new Error(
              `${options.repository} release ${tag} has no asset matching ${source}`,
            );
          }
          const hash = asset.digest
            ? `sha256-${Buffer.from(
                asset.digest.slice("sha256:".length),
                "hex",
              ).toString("base64")}`
            : undefined;

          return [system, { hash, url: asset.browser_download_url }];
        }),
      );
      await source.apply(fetchurl({ urls, version }));
    } else {
      return archive(source, options, { version, rev: tag });
    }

    source.addFiles(additionalFiles(owner, repository, tag, options));
  };

export const branch =
  (options: BranchOptions): SourceDefinition =>
  async (source) => {
    const { rev, date } = await latestCommit(options);

    return archive(source, options, { date, rev });
  };
