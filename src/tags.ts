import { compare, tryParse } from "@std/semver";

import { runCommand } from "./command.ts";
import * as nix from "./nix.ts";

interface TagOptions {
  repository: string;
  tagPattern?: string;
  stripPrefix?: string;
}

export async function selectTag(tags: string[], options: TagOptions) {
  const pattern = new RegExp(`^(?:${options.tagPattern ?? ".*"})$`);
  const matching = tags.filter((tag) => pattern.test(tag));
  if (matching.length === 0) {
    throw new Error(`${options.repository}: no matching tag found`);
  }

  const prefix = options.stripPrefix ?? "";
  const versions = matching.map((tag) => ({
    tag,
    version: tryParse(tag.startsWith(prefix) ? tag.slice(prefix.length) : tag),
  }));
  const tag: string = versions.every(({ version }) => version !== undefined)
    ? versions.sort((a, b) => compare(b.version!, a.version!))[0].tag
    : JSON.parse(
      await runCommand("nix", [
        "eval",
        "--json",
        "--expr",
        `builtins.head (builtins.sort (a: b: builtins.compareVersions a b > 0) [
      ${matching.map(nix.string).join("\n")}
    ])`,
      ]),
    );
  if (!tag.startsWith(prefix)) {
    throw new Error(
      `${options.repository}: tag ${tag} does not start with ${prefix}`,
    );
  }

  return { tag, version: tag.slice(prefix.length) };
}
