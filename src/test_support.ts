import { Source, type SourceDefinition } from "./source.ts";

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
    options: Deno.CommandOptions,
  ) => CommandResult | Promise<CommandResult>,
  run: () => Promise<T>,
): Promise<T> {
  const originalCommand = Deno.Command;
  const encoder = new TextEncoder();
  Deno.Command = class extends originalCommand {
    #program: string;
    #options: Deno.CommandOptions;

    constructor(program: string | URL, options: Deno.CommandOptions = {}) {
      super(program, options);
      this.#program = String(program);
      this.#options = options;
    }

    override async output(): Promise<Deno.CommandOutput> {
      const result = await respond(
        this.#program,
        this.#options.args ?? [],
        this.#options,
      );
      const code = result.code ?? 0;
      return {
        code,
        success: code === 0,
        signal: null,
        stdout: encoder.encode(result.stdout ?? ""),
        stderr: encoder.encode(result.stderr ?? ""),
      };
    }
  };
  try {
    return await run();
  } finally {
    Deno.Command = originalCommand;
  }
}
