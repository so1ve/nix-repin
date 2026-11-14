import { deepStrictEqual, rejects } from "node:assert/strict";

import * as nix from "../nix.ts";
import { image, tag } from "./oci.ts";

interface CommandResult {
  stdout?: string;
  stderr?: string;
  code?: number;
}

async function withCommands(
  respond: (program: string, args: string[]) => CommandResult,
  run: () => Promise<void>,
) {
  const originalCommand = Deno.Command;
  const encoder = new TextEncoder();
  Deno.Command = class extends originalCommand {
    #program: string;
    #args: string[];

    constructor(program: string | URL, options: Deno.CommandOptions = {}) {
      super(program, options);
      this.#program = String(program);
      this.#args = options.args ?? [];
    }

    override output(): Promise<Deno.CommandOutput> {
      const result = respond(this.#program, this.#args);
      const code = result.code ?? 0;
      return Promise.resolve({
        code,
        success: code === 0,
        signal: null,
        stdout: encoder.encode(result.stdout ?? ""),
        stderr: encoder.encode(result.stderr ?? ""),
      });
    }
  };
  try {
    await run();
  } finally {
    Deno.Command = originalCommand;
  }
}

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
      const context = { packageDirectory: directory };
      const first = await definition(context);
      await Deno.writeTextFile(
        `${directory}/source.nix`,
        first["source.nix"] as string,
      );
      digest = `sha256:${"b".repeat(64)}`;
      deepStrictEqual(await definition(context), {
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
    const files = await image({
      repository,
      tagPattern: "v1\\.[0-9]+\\.[0-9]+(?:-rc\\.[0-9]+)?",
      stripPrefix: "v",
    })({ packageDirectory: "/tmp/package" });
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
          await image({
            repository: "registry.example/team/image",
            tagPattern: "v1\\.[0-9]+\\.[0-9]+",
          })({ packageDirectory: "/tmp/package" }),
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
          async () => await definition({ packageDirectory: "/tmp/package" }),
          /crane: UNAUTHORIZED: access denied/,
        );
      }
    },
  );
});
