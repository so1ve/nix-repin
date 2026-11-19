import type { ChildProcess, SpawnOptions } from "node:child_process";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { SourceDefinition } from "./source.ts";
import { Source } from "./source.ts";

export async function generateSource(
  definition: SourceDefinition,
  directory = "/tmp/package",
  force = false,
) {
  const source = new Source(directory, force);
  await source.apply(definition);

  return source.files();
}

interface CommandResult {
  stdout?: string;
  stderr?: string;
  code?: number;
}

export async function withCommands<T>(
  respond: (
    program: string,
    args: string[],
    options: SpawnOptions,
  ) => CommandResult | Promise<CommandResult>,
  run: () => Promise<T>,
): Promise<T> {
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = ((
    program: string,
    args: readonly string[] = [],
    options: SpawnOptions = {},
  ) => {
    const child = new EventEmitter() as ChildProcess & {
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    Promise.resolve(respond(program, [...args], options)).then(
      (result) => {
        if (result.stdout) {
          child.stdout.write(result.stdout);
        }
        if (result.stderr) {
          child.stderr.write(result.stderr);
        }
        child.stdout.end();
        child.stderr.end();
        child.emit("close", result.code ?? 0, null);
      },
      (error) => {
        child.emit("error", error);
      },
    );

    return child;
  }) as unknown as typeof childProcess.spawn;
  try {
    return await run();
  } finally {
    childProcess.spawn = originalSpawn;
  }
}
