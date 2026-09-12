import type { SourceDefinition } from "../source.ts";
import { fetchurl } from "./fetchurl.ts";

interface ExtensionOptions {
  namespace: string;
  name: string;
  includePrerelease?: boolean;
}

interface ExtensionVersion {
  version: string;
  preRelease: boolean;
  files: { download: string };
}

interface QueryResponse {
  extensions: ExtensionVersion[];
  totalSize: number;
}

/** Track a universal VSIX from Open VSX, selecting stable releases by default. */
export function extension(options: ExtensionOptions): SourceDefinition {
  return async () => {
    const id = `${options.namespace}.${options.name}`;
    const url = new URL("https://open-vsx.org/api/-/query");
    url.searchParams.set("extensionId", id);
    url.searchParams.set("targetPlatform", "universal");
    url.searchParams.set("includeAllVersions", "true");
    url.searchParams.set("size", "100");
    let offset = 0;

    // The latest alias can include pre-releases. Query versions in the registry's
    // descending version order and continue past pages containing only previews.
    while (true) {
      url.searchParams.set("offset", String(offset));
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${id}: ${url} returned ${response.status}`);
      }
      const page = await response.json() as QueryResponse;
      const release = page.extensions.find((release) =>
        options.includePrerelease || release.preRelease === false
      );
      if (release) {
        return fetchurl({
          urls: { default: release.files.download },
          version: release.version,
        });
      }

      offset += page.extensions.length;
      if (page.extensions.length === 0 || offset >= page.totalSize) {
        const kind = options.includePrerelease ? "" : "stable ";
        throw new Error(`${id}: no ${kind}universal release found on Open VSX`);
      }
    }
  };
}
