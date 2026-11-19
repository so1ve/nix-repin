import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/**
 * Update pnpmDepsHash from the package's pnpmDeps derivation.
 */
export const lock = ({
  attribute = "pnpmDeps",
}: { attribute?: string } = {}): SourceDefinition =>
  dependencyHash(attribute, "pnpmDepsHash");
