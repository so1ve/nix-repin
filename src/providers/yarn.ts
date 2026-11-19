import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/**
 * Update yarnDepsHash from the package's Yarn offline cache derivation.
 */
export const lock = ({
  attribute = "yarnOfflineCache",
}: { attribute?: string } = {}): SourceDefinition =>
  dependencyHash(attribute, "yarnDepsHash");
