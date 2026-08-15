const decoder = new TextDecoder();

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export async function runCommand(
  program: string,
  args: string[],
  options: CommandOptions = {},
): Promise<string> {
  const output = await new Deno.Command(program, {
    args,
    cwd: options.cwd,
    env: options.env,
    stderr: "piped",
    stdout: "piped",
  }).output();

  const stdout = decoder.decode(output.stdout).trim();
  if (output.success) {
    return stdout;
  }

  const stderr = decoder.decode(output.stderr).trim();
  const detail = stderr || stdout || `exit code ${output.code}`;
  throw new Error(`${program}: ${detail}`);
}
