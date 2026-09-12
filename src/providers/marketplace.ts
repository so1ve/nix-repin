import type { SourceDefinition } from "../source.ts";
import { fetchurl } from "./fetchurl.ts";

interface ExtensionOptions {
  publisher: string;
  name: string;
  platforms?: Record<string, string>;
  includePrerelease?: boolean;
}

interface ExtensionVersion {
  version: string;
  targetPlatform?: string;
  properties?: { key: string; value: string }[];
}

interface QueryResponse {
  results: { extensions: { versions: ExtensionVersion[] }[] }[];
}

/** Track Marketplace VSIX downloads, selecting stable releases by default. */
export function extension(options: ExtensionOptions): SourceDefinition {
  return async () => {
    const id = `${options.publisher}.${options.name}`;
    const url =
      "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json;api-version=7.2-preview.1",
      },
      body: JSON.stringify({
        filters: [{ criteria: [{ filterType: 7, value: id }] }],
        // IncludeVersions | IncludeVersionProperties: all platform versions and
        // their Microsoft.VisualStudio.Code.PreRelease flags.
        flags: 17,
      }),
    });
    if (!response.ok) {
      throw new Error(`${id}: ${url} returned ${response.status}`);
    }
    const data = await response.json() as QueryResponse;
    const result = data.results[0].extensions[0];
    if (!result) {
      throw new Error(`${id}: extension not found on Marketplace`);
    }

    const platforms = Object.entries(
      options.platforms ?? { default: "universal" },
    );
    let version: string | undefined;
    const available = new Set<string>();
    // Marketplace returns versions in descending order, with platform variants
    // grouped together. Only choose a version when every requested build exists.
    for (const release of result.versions) {
      const prerelease = release.properties?.some((property) =>
        property.key === "Microsoft.VisualStudio.Code.PreRelease" &&
        property.value === "true"
      );
      if (!options.includePrerelease && prerelease) {
        continue;
      }
      if (release.version !== version) {
        version = release.version;
        available.clear();
      }
      available.add(release.targetPlatform ?? "universal");
      if (platforms.every(([, platform]) => available.has(platform))) {
        const urls = Object.fromEntries(platforms.map(([system, platform]) => {
          const download = new URL(
            `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${options.publisher}/vsextensions/${options.name}/${version}/vspackage`,
          );
          if (platform !== "universal") {
            download.searchParams.set("targetPlatform", platform);
          }
          return [system, {
            url: download.href,
            name: `${id}-${version}-${platform}.zip`,
          }];
        }));
        return fetchurl({ urls, version });
      }
    }
    const kind = options.includePrerelease ? "" : "stable ";
    const targets = platforms.map(([, platform]) => platform).join(", ");
    throw new Error(`${id}: no ${kind}${targets} release found on Marketplace`);
  };
}
