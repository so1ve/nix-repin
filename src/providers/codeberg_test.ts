import { deepStrictEqual, rejects } from "node:assert";

import { archiveUrl, readFile, resolveRef } from "./codeberg.ts";

Deno.test("Codeberg resolves a tag with a slash and reads files at its commit", async () => {
  const repository = "Koromix/rygel";
  const rev = "8d3eff506ae321a80c22ad61536fa14efd23b291";
  const manifest = '{"version":"2.14.1"}\n';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/git/commits/")) {
      deepStrictEqual(
        url.pathname,
        "/api/v1/repos/Koromix/rygel/git/commits/koffi%2F2.14.1",
      );
      return Promise.resolve(Response.json({
        sha: rev,
        commit: { committer: { date: "2025-09-23T12:30:00Z" } },
      }));
    }
    deepStrictEqual(
      url.pathname,
      "/api/v1/repos/Koromix/rygel/raw/src/koffi/package.json",
    );
    deepStrictEqual(url.searchParams.get("ref"), rev);
    return Promise.resolve(new Response(manifest));
  };

  try {
    const commit = await resolveRef(repository, "koffi/2.14.1");
    deepStrictEqual(commit, { rev, date: "2025-09-23" });
    deepStrictEqual(
      await readFile(repository, commit.rev, "src/koffi/package.json"),
      manifest,
    );
    deepStrictEqual(
      archiveUrl(repository, commit.rev),
      `https://codeberg.org/Koromix/rygel/archive/${rev}.tar.gz`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Codeberg reports missing refs and files", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }));
  try {
    await rejects(
      resolveRef("owner/repo", "missing"),
      /git\/commits\/missing.*404/,
    );
    await rejects(
      readFile("owner/repo", "main", "missing.json"),
      /raw\/missing.json.*404/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
