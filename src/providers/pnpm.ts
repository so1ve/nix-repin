import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/** Update pnpmDepsHash from the package's pnpmDeps derivation. */
export function lock(
  { attribute = "pnpmDeps" }: { attribute?: string } = {},
): SourceDefinition {
  return dependencyHash(attribute, "pnpmDepsHash");
}
