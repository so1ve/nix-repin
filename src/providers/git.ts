import { runCommand } from "../command.ts";
import * as nix from "../nix.ts";
import { provider, type SourceDefinition } from "../source.ts";

export interface BranchOptions {
  url: string;
  /** Branch name to track; defaults to the remote's HEAD. */
  branch?: string;
}

/** Track a Git branch and generate a fetchgit source without submodules. */
export function branch(options: BranchOptions): SourceDefinition {
  return provider(async (source) => {
    const ref = options.branch ? `refs/heads/${options.branch}` : "HEAD";
    const output = await runCommand("git", [
      "ls-remote",
      "--",
      options.url,
      ref,
    ]);
    const rev = output.split("\n")
      .map((line) => line.split("\t"))
      .find(([, name]) => name === ref)?.[0];
    if (!rev) {
      throw new Error(`${options.url}: no commit found for ${ref}`);
    }
    if (await source.isCurrent("rev", rev)) {
      return false;
    }

    const fetched = await nix.prefetchGitSource(options.url, rev);
    source.setNixSource(
      fetched.storePath,
      { date: fetched.date, rev: fetched.rev },
      (attributes) =>
        nix.renderSource(
          ["fetchgit"],
          attributes,
          `  src = fetchgit {
    url = ${nix.string(options.url)};
    inherit rev;
    hash = ${nix.string(fetched.hash)};
    fetchSubmodules = false;
  };`,
        ),
    );
  });
}
