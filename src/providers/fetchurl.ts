import * as path from "node:path";

import * as nix from "../nix.ts";
import type { Source, SourceDefinition } from "../source.ts";

interface Input {
  hash?: string;
  name?: string;
  url: string;
}

interface Options {
  file?: string;
  urls: Record<string, string | Input>;
  version: string;
}

interface EvaluatedSource {
  src?: {
    hash?: unknown;
    name?: unknown;
    url?: unknown;
  };
}

const cacheKey = (url: string, name?: string): string =>
  JSON.stringify([url, name ?? ""]);

async function existingHashes(
  source: Source,
  file: string,
  systems: string[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  if (!(await source.shouldSkip(() => true))) {
    return hashes;
  }

  const evaluated = await nix.evalSources(
    path.join(source.packageDirectory, file),
    systems,
  );
  if (evaluated === undefined) {
    return hashes;
  }

  for (const entry of Object.values(evaluated) as (EvaluatedSource | null)[]) {
    const src = entry?.src;
    if (typeof src?.url === "string" && typeof src.hash === "string") {
      const name = typeof src.name === "string" ? src.name : undefined;
      hashes.set(cacheKey(src.url, name), src.hash);
    }
  }

  return hashes;
}

export const fetchurl =
  ({ file = "source.nix", urls, version }: Options): SourceDefinition =>
  async (source) => {
    const entries = Object.entries(urls);
    if (entries.length === 0) {
      throw new Error("fetchurl requires at least one URL");
    }

    const reusable = await existingHashes(
      source,
      file,
      entries.map(([system]) => system),
    );
    const sources = await Promise.all(
      entries.map(async ([system, input]) => {
        const entry = typeof input === "string" ? { url: input } : input;

        return [
          system,
          {
            ...entry,
            hash:
              entry.hash ??
              reusable.get(cacheKey(entry.url, entry.name)) ??
              (await nix.prefetch(entry.url, { name: entry.name })).hash,
          },
        ] as const;
      }),
    );

    // Match nix store prefetch-file's decoding of HTTP Content-Encoding.
    if (sources.length === 1 && sources[0][0] === "default") {
      const entry = sources[0][1];

      return {
        [file]: nix.renderSource(
          ["fetchurl"],
          { version },
          `  src = fetchurl {
    curlOptsList = [ "--compressed" ];
${entry.name ? `    name = ${nix.string(entry.name)};\n` : ""}    url = ${nix.string(
            entry.url,
          )};
    hash = ${nix.string(entry.hash)};
  };`,
        ),
      };
    }

    const sourceSet = sources
      .map(
        ([system, entry]) =>
          `    ${nix.string(system)} = {
${entry.name ? `      name = ${nix.string(entry.name)};\n` : ""}      url = ${nix.string(
            entry.url,
          )};
      hash = ${nix.string(entry.hash)};
    };`,
      )
      .join("\n");
    // eslint-disable-next-line no-template-curly-in-string
    const system = "${stdenv.hostPlatform.system}";
    const selectSource = sources.some(([system]) => system === "default")
      ? `  source =
    sources.${system} or sources.default;`
      : `  source =
    sources.${system}
      or (throw ("unsupported system " + stdenv.hostPlatform.system));`;

    return {
      [file]: nix.renderSource(
        ["fetchurl", "stdenv"],
        { version },
        `  sources = {
${sourceSet}
  };
${selectSource}
  src = fetchurl (
    source
    // {
      curlOptsList = [ "--compressed" ];
    }
  );`,
      ),
    };
  };
