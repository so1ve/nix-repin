import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";

import * as nix from "./nix.ts";

export type FileSource = string | Uint8Array | URL;
export type SourceFiles = Record<string, FileSource>;

interface NixSource {
  attributes: Record<string, string>;
  render: (attributes: Record<string, string>) => string;
  tree: string;
}

/**
 * Mutable source state shared by providers composed with defineSource.
 */
export class Source {
  public readonly packageDirectory: string;
  #files: SourceFiles = {};
  #force: boolean;
  #nixSource: NixSource | undefined;

  constructor(packageDirectory: string, force = false) {
    this.packageDirectory = packageDirectory;
    this.#force = force;
  }

  /**
   * Compare attributes against an existing generated Nix file.
   */
  public async matches(
    attributes: Record<string, unknown>,
    file = "source.nix",
  ): Promise<boolean> {
    const keys = Object.keys(attributes);
    const existing = await nix.evalSource(
      path.join(this.packageDirectory, file),
      keys,
    );
    if (existing === undefined) {
      return false;
    }

    return keys.every(
      (name) =>
        Object.hasOwn(existing, name) &&
        isDeepStrictEqual(existing[name], attributes[name]),
    );
  }

  /**
   * Skip unchanged sources unless forced; forcing bypasses the check itself.
   */
  public async shouldSkip(
    unchanged: () => boolean | Promise<boolean>,
  ): Promise<boolean> {
    return !this.#force && (await unchanged());
  }

  /**
   * Run a definition, collecting its files or discarding the update on false.
   */
  public async apply(definition: SourceDefinition): Promise<boolean> {
    const result = await definition(this);
    if (typeof result === "function") {
      return this.apply(result);
    }
    if (result === false) {
      this.#files = {};
      this.#nixSource = undefined;

      return false;
    }
    if (result !== undefined) {
      this.addFiles(result);
    }

    return true;
  }

  public addFiles(files: SourceFiles): void {
    for (const [filePath, source] of Object.entries(files)) {
      if (filePath === "source.nix" && this.#nixSource !== undefined) {
        throw new Error("source.nix is managed by another provider");
      }
      if (this.#files[filePath] !== undefined) {
        throw new Error(`multiple providers generate ${filePath}`);
      }
      this.#files[filePath] = source;
    }
  }

  public setNixSource(
    tree: string,
    attributes: Record<string, string>,
    render: (attributes: Record<string, string>) => string,
  ): void {
    if (
      this.#nixSource !== undefined ||
      this.#files["source.nix"] !== undefined
    ) {
      throw new Error("multiple providers generate source.nix");
    }
    this.#nixSource = { attributes, render, tree };
  }

  public addNixAttribute(name: string, value: string): void {
    if (this.#nixSource === undefined) {
      throw new Error("provider requires an archive source");
    }
    if (this.#nixSource.attributes[name] !== undefined) {
      throw new Error(`multiple providers set ${name}`);
    }
    this.#nixSource.attributes[name] = value;
  }

  public sourceFile(file: string): string {
    if (this.#nixSource === undefined) {
      throw new Error("provider requires an archive source");
    }

    const target = path.resolve(this.#nixSource.tree, file);
    const relative = path.relative(this.#nixSource.tree, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`source file must be within the archive: ${file}`);
    }

    return target;
  }

  /**
   * Read a UTF-8 file from the fetched archive source.
   */
  public readSourceFile(file: string): Promise<string> {
    return fs.readFile(this.sourceFile(file), "utf8");
  }

  public files(): SourceFiles {
    return {
      ...this.#files,
      ...(this.#nixSource
        ? { "source.nix": this.#nixSource.render(this.#nixSource.attributes) }
        : {}),
    };
  }
}

export type SourceDefinition = (
  source: Source,
) =>
  | void
  | false
  | SourceFiles
  | SourceDefinition
  | Promise<void | false | SourceFiles | SourceDefinition>;

/**
 * Compose providers so they share one source archive and generated output.
 */
export const defineSource =
  (...definitions: SourceDefinition[]): SourceDefinition =>
  async (source) => {
    for (const definition of definitions) {
      if (!(await source.apply(definition))) {
        return false;
      }
    }
  };
