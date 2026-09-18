import { execFile } from 'node:child_process';
export function command(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  timeout = 5000
): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      binary,
      args,
      { env, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `${binary.split('/').pop()}: ${error.killed ? 'timed out' : stderr.trim() || error.message}`
            )
          );
        else resolve(stdout);
      }
    )
  );
}
