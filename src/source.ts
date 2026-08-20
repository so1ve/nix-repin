export type FileSource = string | Uint8Array | URL;
export type SourceFiles = Record<string, FileSource>;

export interface SourceContext {
  /** Absolute path containing the source definition and generated files. */
  readonly packageDirectory: string;
}

export type SourceDefinition = (
  context: SourceContext,
) => SourceFiles | Promise<SourceFiles>;

export function defineSource(definition: SourceDefinition): SourceDefinition {
  return definition;
}
