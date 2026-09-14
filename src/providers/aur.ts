import type { SourceDefinition } from "../source.ts";
import { template } from "../template.ts";
import { fetchurl } from "./fetchurl.ts";

interface PackageOptions {
  /** Published AUR package name. */
  name: string;
  /** Download URLs by Nix system, with {version} and {system} placeholders. */
  urls: Record<string, string>;
}

/** Track an AUR package's upstream version without executing its PKGBUILD. */
export function pkg(options: PackageOptions): SourceDefinition {
  return async () => {
    const url = new URL("https://aur.archlinux.org/rpc/v5/info");
    url.searchParams.set("arg[]", options.name);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${options.name}: ${url} returned ${response.status}`);
    }

    const data = await response.json() as {
      error?: string;
      results?: { Name: string; Version: string }[];
      type: string;
    };
    if (data.type === "error") {
      throw new Error(`${options.name}: AUR RPC error: ${data.error}`);
    }

    const result = data.results?.find((result) => result.Name === options.name);
    if (!result) {
      throw new Error(`${options.name}: package not found in AUR`);
    }

    const version = result.Version.replace(/^[0-9]+:/, "").replace(
      /-[^-]+$/,
      "",
    );
    const urls = Object.fromEntries(
      Object.entries(options.urls).map(([system, source]) => [
        system,
        template(source).render({ version, system }),
      ]),
    );

    return fetchurl({ urls, version });
  };
}
