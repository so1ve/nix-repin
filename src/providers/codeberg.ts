import * as nix from "../nix.ts";

function repositoryPath(repository: string): string {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error(`repository must be owner/repo: ${repository}`);
  }
  return parts.map(encodeURIComponent).join("/");
}

async function request(url: URL | string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response;
}

/** Resolve a branch, tag or commit to its full rev and date (YYYY-MM-DD). */
export async function resolveRef(
  repository: string,
  ref: string,
): Promise<{ rev: string; date: string }> {
  const response = await request(
    `https://codeberg.org/api/v1/repos/${
      repositoryPath(repository)
    }/git/commits/${
      encodeURIComponent(ref)
    }?stat=false&verification=false&files=false`,
  );
  const commit = await response.json() as {
    sha: string;
    commit: { committer: { date: string } };
  };
  return { rev: commit.sha, date: commit.commit.committer.date.slice(0, 10) };
}

/** Read a UTF-8 file at a branch, tag or commit. */
export async function readFile(
  repository: string,
  revision: string,
  path: string,
): Promise<string> {
  const url = new URL(
    `https://codeberg.org/api/v1/repos/${repositoryPath(repository)}/raw/${
      path.split("/").map(encodeURIComponent).join("/")
    }`,
  );
  url.searchParams.set("ref", revision);
  return (await request(url)).text();
}

/** Build the tar.gz URL for a Codeberg revision without fetching it. */
export function archiveUrl(repository: string, revision: string): string {
  return `https://codeberg.org/${repositoryPath(repository)}/archive/${
    encodeURIComponent(revision)
  }.tar.gz`;
}

/** Fetch an archive; use unpack: false for a raw tarball hash suitable for fetchurl. */
export async function prefetchArchive(
  repository: string,
  revision: string,
  { unpack = true }: { unpack?: boolean } = {},
): Promise<nix.PrefetchResult & { url: string }> {
  const url = archiveUrl(repository, revision);
  return { ...await nix.prefetch(url, { unpack }), url };
}
