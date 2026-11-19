import childProcess from "node:child_process";

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export const runCommand = (
  program: string,
  args: string[],
  options: CommandOptions = {},
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = childProcess.spawn(program, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      if (code === 0) {
        resolve(stdout);

        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      const detail =
        stderr || stdout || (signal ? `signal ${signal}` : `exit code ${code}`);
      reject(new Error(`${program}: ${detail}`));
    });
  });
