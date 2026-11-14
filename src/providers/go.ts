import { type SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/** Hash the package's goModules derivation with its repository's toolchain. */
export function lock(): SourceDefinition {
  return dependencyHash("goModules", "vendorHash");
}
