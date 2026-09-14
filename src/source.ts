import * as path from "@std/path";

export type FileSource = string | Uint8Array | URL;
export type SourceFiles = Record<string, FileSource>;

export interface SourceContext {
  /** Absolute path containing the source definition and generated files. */
  readonly packageDirectory: string;
}

interface NixSource {
  attributes: Record<string, string>;
  render: (attributes: Record<string, string>) => string;
  tree: string;
}

/** Mutable source state shared by providers composed with defineSource. */
export class Source implements SourceContext {
  readonly packageDirectory: string;
  #files: SourceFiles = {};
  #nixSource: NixSource | undefined;

  constructor(context: SourceContext) {
    this.packageDirectory = context.packageDirectory;
  }

  addFiles(files: SourceFiles): void {
    for (const [path, source] of Object.entries(files)) {
      if (path === "source.nix" && this.#nixSource !== undefined) {
        throw new Error("source.nix is managed by another provider");
      }
      if (this.#files[path] !== undefined) {
        throw new Error(`multiple providers generate ${path}`);
      }
      this.#files[path] = source;
    }
  }

  setNixSource(
    tree: string,
    attributes: Record<string, string>,
    render: (attributes: Record<string, string>) => string,
  ): void {
    if (
      this.#nixSource !== undefined || this.#files["source.nix"] !== undefined
    ) {
      throw new Error("multiple providers generate source.nix");
    }
    this.#nixSource = { attributes, render, tree };
  }

  addNixAttribute(name: string, value: string): void {
    if (this.#nixSource === undefined) {
      throw new Error("provider requires an archive source");
    }
    if (this.#nixSource.attributes[name] !== undefined) {
      throw new Error(`multiple providers set ${name}`);
    }
    this.#nixSource.attributes[name] = value;
  }

  sourceFile(file: string): string {
    if (this.#nixSource === undefined) {
      throw new Error("provider requires an archive source");
    }

    const target = path.resolve(this.#nixSource.tree, file);
    const relative = path.relative(this.#nixSource.tree, target);
    if (relative === ".." || relative.startsWith(`..${path.SEPARATOR}`)) {
      throw new Error(`source file must be within the archive: ${file}`);
    }
    return target;
  }

  files(): SourceFiles {
    return {
      ...this.#files,
      ...(this.#nixSource
        ? { "source.nix": this.#nixSource.render(this.#nixSource.attributes) }
        : {}),
    };
  }
}

export type SourceDefinition = (
  context: SourceContext,
) => SourceFiles | Promise<SourceFiles>;

type Provider = (source: Source) =>
  | void
  | SourceFiles
  | Promise<void | SourceFiles>;

const providerRun = Symbol("nix-repin.provider-run");

type ComposableSourceDefinition = SourceDefinition & {
  [providerRun]?: Provider;
};

async function applyProvider(
  source: Source,
  definition: SourceDefinition,
): Promise<void> {
  const provider = (definition as ComposableSourceDefinition)[providerRun];
  const files = provider ? await provider(source) : await definition(source);
  if (files !== undefined) {
    source.addFiles(files);
  }
}

/** Create a provider that can be used directly or composed with defineSource. */
export function provider(run: Provider): SourceDefinition {
  const definition: ComposableSourceDefinition = async (context) => {
    const source = new Source(context);
    const files = await run(source);
    if (files !== undefined) {
      source.addFiles(files);
    }
    return source.files();
  };
  definition[providerRun] = run;
  return definition;
}

/** Compose providers so they share one source archive and generated output. */
export function defineSource(
  ...definitions: SourceDefinition[]
): SourceDefinition {
  return provider(async (source) => {
    for (const definition of definitions) {
      await applyProvider(source, definition);
    }
  });
}
