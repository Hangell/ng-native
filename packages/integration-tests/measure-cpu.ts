import { execFileSync } from 'node:child_process';

/** Measure warmed synchronous work without coverage instrumentation or CPU scheduling delays. */
export function measureCpu(module: string, operation: string, input: unknown): number {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `
        const subject = require(process.argv[1]);
        const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
        const run = () => { ${operation} };
        run();
        const samples = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          const started = process.cpuUsage();
          run();
          const { user, system } = process.cpuUsage(started);
          samples.push((user + system) / 1000);
        }
        // A single GC cycle must not fail a guard against sustained pathological work.
        process.stdout.write(String(Math.min(...samples)));
      `,
      module,
    ],
    {
      // Node propagates this variable even when it is omitted from a custom environment.
      env: { ...process.env, NODE_V8_COVERAGE: '' },
      input: JSON.stringify(input),
      encoding: 'utf8',
      // A catastrophic path still terminates even if it never returns a CPU measurement.
      timeout: 60_000,
    },
  );
  return JSON.parse(output) as number;
}
