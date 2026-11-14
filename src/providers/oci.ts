import { runCommand } from "../command.ts";
import * as nix from "../nix.ts";
import type { SourceDefinition, SourceFiles } from "../source.ts";
import { selectTag } from "../tags.ts";

async function pinImage(repository: string, tag: string): Promise<SourceFiles> {
  const reference = `${repository}:${tag}`;
  // Without a platform override, crane resolves the multi-platform index.
  const digest = await runCommand("crane", ["digest", "--", reference]);
  return {
    "source.nix": `${nix.HEADER}{
  image = ${nix.string(`${reference}@${digest}`)};
}
`,
  };
}

export interface TagOptions {
  /** Registry and repository, without a tag or digest. */
  repository: string;
  tag: string;
}

/** Refresh the digest of a fixed tag. */
export function tag(options: TagOptions): SourceDefinition {
  return () => pinImage(options.repository, options.tag);
}

export interface ImageOptions {
  repository: string;
  /** Regular expression matched against the whole tag. */
  tagPattern: string;
  stripPrefix?: string;
}

/** Pin the highest matching version tag. */
export function image(options: ImageOptions): SourceDefinition {
  return async () => {
    const tags = await runCommand("crane", ["ls", "--", options.repository]);
    const { tag } = await selectTag(tags.split("\n").filter(Boolean), options);

    return pinImage(options.repository, tag);
  };
}
