export type FileSource = string | Uint8Array | URL;
export type SourceFiles = Record<string, FileSource>;
export type SourceDefinition = () => SourceFiles | Promise<SourceFiles>;

export function defineSource(definition: SourceDefinition): SourceDefinition {
  return definition;
}
