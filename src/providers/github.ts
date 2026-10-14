import { Octokit } from "octokit";

import { runCommand } from "../command.ts";
import * as nix from "../nix.ts";
import {
  provider,
  type Source,
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

export interface CommitOptions {
  repository: string;
  /** Branch to track; defaults to the repository's default branch. */
  branch?: string;
  /** Only consider commits before this ISO 8601 timestamp. */
  before?: string;
}

type BranchOptions = CommonOptions & CommitOptions;

interface TagOptions extends CommonOptions {
  /** Regular expression matched against the whole tag. */
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

export interface ArchiveSource extends nix.PrefetchResult {
  url: string;
}

/** Download and unpack a GitHub revision, returning its URL, hash and store path. */
export async function prefetchArchive(
  repository: string,
  revision: string,
): Promise<ArchiveSource> {
  const [owner, name] = parseRepository(repository);
  const url = `https://codeload.github.com/${owner}/${name}/tar.gz/${revision}`;
  const { hash, storePath } = await nix.prefetch(url, { unpack: true });

  return { hash, storePath, url };
}

/** Resolve a branch's newest commit, optionally bounded by a publication cutoff. */
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

async function selectTag(tags: string[], options: TagOptions) {
  const pattern = new RegExp(`^(?:${options.tagPattern ?? ".*"})$`);
  const matching = tags.filter((tag) => pattern.test(tag));
  if (matching.length === 0) {
    throw new Error(`${options.repository}: no matching tag found`);
  }

  const tag: string = JSON.parse(
    await runCommand("nix", [
      "eval",
      "--json",
      "--expr",
      `builtins.head (builtins.sort (a: b: builtins.compareVersions a b > 0) [
      ${matching.map(nix.string).join("\n")}
    ])`,
    ]),
  );
  const prefix = options.stripPrefix ?? "";
  if (!tag.startsWith(prefix)) {
    throw new Error(
      `${options.repository}: tag ${tag} does not start with ${prefix}`,
    );
  }

  return { tag, version: tag.slice(prefix.length) };
}

async function archive(
  source: Source,
  options: CommonOptions,
  attributes: Record<string, string> & { rev: string },
): Promise<false | void> {
  try {
    const current = await Deno.readTextFile(
      `${source.packageDirectory}/source.nix`,
    );
    if (current.includes(`\n  rev = ${nix.string(attributes.rev)};\n`)) {
      return false;
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  const fetched = await prefetchArchive(options.repository, attributes.rev);
  source.setNixSource(
    fetched.storePath,
    attributes,
    (attributes) => archiveSourceNix(fetched, attributes),
  );
  const [owner, repository] = parseRepository(options.repository);
  source.addFiles(additionalFiles(owner, repository, attributes.rev, options));
}

/** Track the highest matching tag, including repositories without releases. */
export function tag(options: TagOptions): SourceDefinition {
  return provider(async (source) => {
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
  });
}

export function release(options: ReleaseOptions): SourceDefinition {
  return provider(async (source) => {
    const [owner, repository] = parseRepository(options.repository);
    const releases = (await octokit.paginate(octokit.rest.repos.listReleases, {
      owner,
      repo: repository,
      per_page: 100,
    })).filter((release) =>
      !release.draft && (options.includePrerelease || !release.prerelease)
    );
    const { tag, version } = await selectTag(
      releases.map((release) => release.tag_name),
      options,
    );
    const release = releases.find((release) => release.tag_name === tag)!;
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
      return archive(source, options, { version, rev: tag });
    }

    source.addFiles(additionalFiles(owner, repository, tag, options));
  });
}

export function branch(options: BranchOptions): SourceDefinition {
  return provider(async (source) => {
    const { rev, date } = await latestCommit(options);
    return archive(source, options, { date, rev });
  });
}
