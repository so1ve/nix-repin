import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/** Hash pnpmDeps, optionally at a nested attribute such as frontend.pnpmDeps. */
export function lock(attribute = "pnpmDeps"): SourceDefinition {
  return dependencyHash(attribute, "pnpmDepsHash");
}
