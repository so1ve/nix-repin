import { deepStrictEqual, rejects } from "node:assert/strict";

import * as nix from "../nix.ts";
import { generateSource, withCommands } from "../test_support.ts";
import { image, tag } from "./oci.ts";

Deno.test("OCI refreshes a moving tag even when source.nix already exists", async () => {
  const directory = await Deno.makeTempDir({ prefix: "nix-repin-oci-test-" });
  const repository = "registry.example:5000/team/image";
  let digest = `sha256:${"a".repeat(64)}`;
  try {
    await withCommands((program, args) => {
      deepStrictEqual(program, "crane");
      deepStrictEqual(args, ["digest", "--", `${repository}:latest`]);
      return { stdout: digest };
    }, async () => {
      const definition = tag({ repository, tag: "latest" });
      const first = await generateSource(definition, directory);
      await Deno.writeTextFile(
        `${directory}/source.nix`,
        first["source.nix"] as string,
      );
      digest = `sha256:${"b".repeat(64)}`;
      deepStrictEqual(await generateSource(definition, directory), {
        "source.nix": `${nix.HEADER}{
  image = "registry.example:5000/team/image:latest@${digest}";
}
`,
      });
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("OCI selects the highest matching tag using semantic version order", async () => {
  const repository = "registry.example/team/image";
  const digest = `sha256:${"c".repeat(64)}`;
  await withCommands((program, args) => {
    deepStrictEqual(program, "crane");
    if (args[0] === "ls") {
      deepStrictEqual(args, ["ls", "--", repository]);
      return {
        stdout: "v1.9.0\nv2.0.0\nv1.10.0-rc.1\nv1.10.0\nv1.10.0-extra\n",
      };
    }
    deepStrictEqual(args, ["digest", "--", `${repository}:v1.10.0`]);
    return { stdout: digest };
  }, async () => {
    const files = await generateSource(image({
      repository,
      tagPattern: "v1\\.[0-9]+\\.[0-9]+(?:-rc\\.[0-9]+)?",
      stripPrefix: "v",
    }));
    deepStrictEqual(files, {
      "source.nix": `${nix.HEADER}{
  image = "registry.example/team/image:v1.10.0@${digest}";
}
`,
    });
  });
});

Deno.test("OCI reports a missing version instead of generating a reference", async () => {
  for (const tags of ["latest\nv2.0.0", ""]) {
    await withCommands((program, args) => {
      deepStrictEqual([program, ...args], [
        "crane",
        "ls",
        "--",
        "registry.example/team/image",
      ]);
      return { stdout: tags };
    }, async () => {
      await rejects(
        async () =>
          await generateSource(image({
            repository: "registry.example/team/image",
            tagPattern: "v1\\.[0-9]+\\.[0-9]+",
          })),
        /registry\.example\/team\/image: no matching tag found/,
      );
    });
  }
});

Deno.test("OCI propagates registry failures from tag and digest lookup", async () => {
  await withCommands(
    () => ({ code: 1, stderr: "UNAUTHORIZED: access denied" }),
    async () => {
      for (
        const definition of [
          tag({
            repository: "registry.example/private/image",
            tag: "latest",
          }),
          image({
            repository: "registry.example/private/image",
            tagPattern: ".*",
          }),
        ]
      ) {
        await rejects(
          () => generateSource(definition),
          /crane: UNAUTHORIZED: access denied/,
        );
      }
    },
  );
});
