import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/** Update yarnDepsHash from the package's Yarn offline cache derivation. */
export function lock(
  { attribute = "yarnOfflineCache" }: { attribute?: string } = {},
): SourceDefinition {
  return dependencyHash(attribute, "yarnDepsHash");
}
