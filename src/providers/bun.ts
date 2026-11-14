import { type SourceDefinition } from "../source.ts";
import { dependencyHash } from "./dependency.ts";

/** Hash the package's node_modules derivation with its repository's toolchain. */
export function lock(): SourceDefinition {
  return dependencyHash("node_modules", "bunDepsHash");
}
