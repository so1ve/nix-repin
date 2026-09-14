import * as nix from "../nix.ts";
import type { SourceFiles } from "../source.ts";

interface Input {
  hash?: string;
  name?: string;
  url: string;
}

interface Options {
  urls: Record<string, string | Input>;
  version: string;
}

export async function fetchurl(
  { urls, version }: Options,
): Promise<SourceFiles> {
  const sources = await Promise.all(
    Object.entries(urls).map(async ([system, input]) => {
      const source = typeof input === "string" ? { url: input } : input;

      return [
        system,
        {
          ...source,
          hash: source.hash ??
            (await nix.prefetch(source.url, { name: source.name })).hash,
        },
      ] as const;
    }),
  );
  if (sources.length === 0) {
    throw new Error("fetchurl requires at least one URL");
  }

  // Match nix store prefetch-file's decoding of HTTP Content-Encoding.
  if (sources.length === 1 && sources[0][0] === "default") {
    const source = sources[0][1];

    return {
      "source.nix": nix.renderSource(
        ["fetchurl"],
        { version },
        `  src = fetchurl {
    curlOptsList = [ "--compressed" ];
${source.name ? `    name = ${nix.string(source.name)};\n` : ""}    url = ${
          nix.string(source.url)
        };
    hash = ${nix.string(source.hash)};
  };`,
      ),
    };
  }

  const sourceSet = sources
    .map(([system, source]) =>
      `    ${nix.string(system)} = {
${source.name ? `      name = ${nix.string(source.name)};\n` : ""}      url = ${
        nix.string(source.url)
      };
      hash = ${nix.string(source.hash)};
    };`
    )
    .join("\n");
  const system = "${stdenv.hostPlatform.system}";
  const selectSource = sources.some(([system]) => system === "default")
    ? `  source =
    sources.${system} or sources.default;`
    : `  source =
    sources.${system}
      or (throw ("unsupported system " + stdenv.hostPlatform.system));`;

  return {
    "source.nix": nix.renderSource(
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
}
