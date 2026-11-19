import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/**
 * Update bunDepsHash from the package's node_modules derivation.
 */
export const lock = ({
  attribute = "node_modules",
}: { attribute?: string } = {}): SourceDefinition =>
  dependencyHash(attribute, "bunDepsHash");
