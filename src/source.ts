import * as path from "@std/path";

import { readTextFileIfExists } from "./files.ts";
import * as nix from "./nix.ts";

export type FileSource = string | Uint8Array | URL;
export type SourceFiles = Record<string, FileSource>;

interface NixSource {
  attributes: Record<string, string>;
  render: (attributes: Record<string, string>) => string;
  tree: string;
}

/** Mutable source state shared by providers composed with defineSource. */
export class Source {
  #files: SourceFiles = {};
  #nixSource: NixSource | undefined;

  constructor(
    readonly packageDirectory: string,
    private readonly force = false,
  ) {}

  /** Compare attributes against the existing generated source.nix. */
  async matches(attributes: Record<string, string>): Promise<boolean> {
    const previous = await readTextFileIfExists(
      path.join(this.packageDirectory, "source.nix"),
    );
    if (previous === undefined) return false;

    return Object.entries(attributes).every(([name, value]) =>
      previous.includes(`\n  ${name} = ${nix.string(value)};\n`)
    );
  }

  /** Skip unchanged sources unless forced; forcing bypasses the check itself. */
  async shouldSkip(
    unchanged: () => boolean | Promise<boolean>,
  ): Promise<boolean> {
    return !this.force && await unchanged();
  }

  /** Run a definition, collecting its files or discarding the update on false. */
  async apply(definition: SourceDefinition): Promise<boolean> {
    const files = await definition(this);
    if (files === false) {
      this.#files = {};
      this.#nixSource = undefined;
      return false;
    }
    if (files !== undefined) {
      this.addFiles(files);
    }

    return true;
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

export type SourceDefinition = (source: Source) =>
  | void
  | false
  | SourceFiles
  | Promise<void | false | SourceFiles>;

/** Compose providers so they share one source archive and generated output. */
export function defineSource(
  ...definitions: SourceDefinition[]
): SourceDefinition {
  return async (source) => {
    for (const definition of definitions) {
      if (!await source.apply(definition)) {
        return false;
      }
    }
  };
}
