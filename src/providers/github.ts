import { Octokit } from "octokit";

import * as nix from "../nix.ts";
import type { SourceDefinition, SourceFiles } from "../source.ts";
import { fetchurl } from "./fetchurl.ts";

const octokit = new Octokit({
  auth: Deno.env.get("GITHUB_TOKEN") ?? Deno.env.get("GH_TOKEN"),
  userAgent: "nix-repin",
});

interface BranchOptions {
  branch: string;
  files?: string[];
  repository: string;
}

interface ReleaseOptions {
  assets?: Record<string, string>;
  files?: string[];
  repository: string;
  stripPrefix?: string;
}

function parseRepository(value: string): [owner: string, repository: string] {
  const [owner, name, extra] = value.split("/");
  if (!owner || !name || extra) {
    throw new Error(`repository must be owner/repo: ${value}`);
  }

  return [owner, name];
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
      new URL(
        `https://raw.githubusercontent.com/${
          [owner, repository, revision, ...path.split("/")]
            .map(encodeURIComponent)
            .join("/")
        }`,
      ),
    ]),
  );
}

async function archiveSource(
  owner: string,
  repository: string,
  revision: string,
  attributes: Record<string, string>,
): Promise<string> {
  const url =
    `https://github.com/${owner}/${repository}/archive/${revision}.tar.gz`;
  const hash = await nix.prefetch(url, true);

  return nix.renderSource(
    ["fetchFromGitHub"],
    { ...attributes, rev: revision },
    `  src = fetchFromGitHub {
    owner = ${nix.string(owner)};
    repo = ${nix.string(repository)};
    inherit rev;
    hash = ${nix.string(hash)};
  };`,
  );
}

export function release(options: ReleaseOptions): SourceDefinition {
  return async () => {
    const [owner, repository] = parseRepository(options.repository);
    const { data: release } = await octokit.rest.repos.getLatestRelease({
      owner,
      repo: repository,
    });
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
        Object.entries(options.assets).map(([system, template]) => {
          const name = template
            .replaceAll("{version}", version)
            .replaceAll("{tag}", tag)
            .replaceAll("{system}", system);
          const asset = release.assets.find((asset) => asset.name === name);
          if (!asset) {
            throw new Error(
              `${options.repository} release ${tag} has no asset ${name}`,
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
      files = {
        "source.nix": await archiveSource(
          owner,
          repository,
          tag,
          { version },
        ),
      };
    }

    if (options.files) {
      Object.assign(
        files,
        rawFiles(owner, repository, tag, options.files),
      );
    }

    return files;
  };
}

export function branch(options: BranchOptions): SourceDefinition {
  return async () => {
    const [owner, repository] = parseRepository(options.repository);
    const { data: commit } = await octokit.rest.repos.getCommit({
      owner,
      ref: options.branch,
      repo: repository,
    });
    const date = commit.commit.committer!.date!.slice(0, 10);

    const files: SourceFiles = {
      "source.nix": await archiveSource(
        owner,
        repository,
        commit.sha,
        { date },
      ),
    };
    if (options.files) {
      Object.assign(
        files,
        rawFiles(owner, repository, commit.sha, options.files),
      );
    }

    return files;
  };
}
