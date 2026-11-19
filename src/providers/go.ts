import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/**
 * Update vendorHash from the package's goModules derivation.
 */
export const lock = ({
  attribute = "goModules",
}: { attribute?: string } = {}): SourceDefinition =>
  dependencyHash(attribute, "vendorHash");
