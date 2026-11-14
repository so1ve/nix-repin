import type { SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/** Update vendorHash from the package's goModules derivation. */
export function lock(
  { attribute = "goModules" }: { attribute?: string } = {},
): SourceDefinition {
  return dependencyHash(attribute, "vendorHash");
}
