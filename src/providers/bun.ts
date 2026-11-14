import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/** Update bunDepsHash from the package's node_modules derivation. */
export function lock(
  { attribute = "node_modules" }: { attribute?: string } = {},
): SourceDefinition {
  return dependencyHash(attribute, "bunDepsHash");
}
