import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

it('keeps compiled fixtures and their imports private to each test process', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'compile-fixture-'));
  try {
    symlinkSync(
      fileURLToPath(new URL('./node_modules', import.meta.url)),
      path.join(root, 'node_modules'),
      'dir',
    );
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(
      path.join(root, 'base.ts'),
      `
      import { Directive } from '@angular/core';
      @Directive({}) export class Base {}
    `,
    );
    const file = path.join(root, 'probe.ts');
    writeFileSync(
      file,
      `
      import { Directive } from '@angular/core';
      import { Base } from './base.ts';
      @Directive({ selector: 'probe' }) export class Probe extends Base {}
    `,
    );
    const code = `
      import { compileFixture, compileFixtureForWeb } from ${JSON.stringify(new URL('./compile.ts', import.meta.url).href)};
      const native = await compileFixture(process.argv[1]);
      const web = await compileFixtureForWeb(process.argv[1]);
      process.stdout.write(JSON.stringify({
        pid: process.pid,
        sameBase: Object.getPrototypeOf(native.Probe) === Object.getPrototypeOf(web.Probe),
      }));
    `;
    const compile = () =>
      run(process.execPath, [
        '--import',
        fileURLToPath(new URL('./register-linker.mjs', import.meta.url)),
        '--input-type=module',
        '-e',
        code,
        file,
      ]);
    const results = await Promise.allSettled([compile(), compile()]);
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      const { stdout } = result.value;
      const { pid, sameBase } = JSON.parse(stdout) as { pid: number; sameBase: boolean };
      assert.equal(sameBase, true, 'native and web fixtures use the same primitive class');
      for (const variant of ['', '.web']) {
        const generated = path.join(root, `probe${variant}.process-${pid}.generated.ts`);
        assert.match(
          readFileSync(generated, 'utf8'),
          new RegExp(`base\\.process-${pid}\\.generated\\.ts`),
        );
      }
      assert.ok(
        readFileSync(path.join(root, `base.process-${pid}.generated.ts`), 'utf8').includes(
          'class Base',
        ),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
