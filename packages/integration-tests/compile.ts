/**
 * AOT-compiles a source file through the exact same code path the Metro transformer uses, so
 * the tests exercise the real compiler rather than hand-written Ivy output.
 *
 * Relative imports that are themselves Angular sources are compiled too, so a fixture can
 * import the real host primitives instead of restating them.
 *
 * That is why the tests reach into `packages/*\/src/` by path rather than importing
 * `@ng-native/components` the way an app does: this walk needs the source file, and a
 * package barrel would pull decorated classes into Node, which cannot erase decorators.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { transformAngular } = require('@ng-native/metro/angular-transform.cjs') as {
  transformAngular: (
    src: string,
    filename: string,
    options?: { dev?: boolean; platform?: 'web' },
  ) => { code: string; dependencies: string[] };
};

const HAS_ANGULAR_DECORATOR = /@(Component|Directive|Pipe|Injectable|NgModule)\s*\(/;
const RELATIVE_TS_IMPORT = /(from\s+|import\s+)(['"])(\.[^'"]*\.ts)\2/g;
const RESOURCE_IMPORT = /^import "\.\.?\/.*\.(html|css|scss)";$/gm;

export function compileToCode(file: string): { code: string; dependencies: string[] } {
  return transformAngular(readFileSync(file, 'utf8'), file);
}

/** Point relative imports of Angular sources at their compiled counterparts, compiling them. */
function rewriteImports(code: string, file: string, seen: Set<string>): string {
  code = code.replace(RESOURCE_IMPORT, '');
  return code.replace(RELATIVE_TS_IMPORT, (match, keyword, quote, specifier: string) => {
    const target = path.resolve(path.dirname(file), specifier);
    if (!existsSync(target) || !HAS_ANGULAR_DECORATOR.test(readFileSync(target, 'utf8'))) {
      return match;
    }
    const generated = emit(target, seen);
    return `${keyword}${quote}${path.relative(path.dirname(file), generated).replace(/^(?!\.)/, './')}${quote}`;
  });
}

/**
 * Write, then move into place.
 *
 * Each process owns its generated copies. Keep the swap atomic too, so an import never reads
 * half a file when another fixture in this process compiles the same primitive.
 */
function writeAtomically(out: string, code: string): void {
  const temporary = `${out}.${process.pid}.tmp`;
  writeFileSync(temporary, code);
  renameSync(temporary, out);
}

function emit(file: string, seen: Set<string>): string {
  // Some filesystems expose a missing destination while replacing it. Parallel test processes
  // must not overwrite a copy another process is resolving or importing.
  const out = file.replace(/\.ts$/, `.process-${process.pid}.generated.ts`);
  if (seen.has(file)) return out;
  seen.add(file);

  const { code } = transformAngular(readFileSync(file, 'utf8'), file);
  // Node's own type stripping stands in for what @react-native/babel-preset does in Metro.
  writeAtomically(out, rewriteImports(code, file, seen));
  return out;
}

export async function compileFixture(file: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(emit(file, new Set())).href);
}

/**
 * The same fixture compiled as Metro compiles it for the browser, where a component's `styles`
 * stay CSS rather than becoming the native rule set. Only the fixture itself: the primitives it
 * imports carry no styles, so they are the native copies `compileFixture` writes, and a test that
 * renders both ways renders the same component classes.
 */
export async function compileFixtureForWeb(file: string): Promise<Record<string, unknown>> {
  const out = file.replace(/\.ts$/, `.web.process-${process.pid}.generated.ts`);
  const { code } = transformAngular(readFileSync(file, 'utf8'), file, { platform: 'web' });
  writeAtomically(out, rewriteImports(code, file, new Set()));
  return import(pathToFileURL(out).href);
}

/**
 * Compile source text as if it were `file`, writing the result to `out` and importing it. For
 * tests that edit a fixture in memory, as HMR does across a save.
 */
export async function compileSource(
  source: string,
  file: string,
  out: string,
  options: { dev?: boolean } = {},
): Promise<Record<string, unknown>> {
  const { code } = transformAngular(source, file, options);
  writeAtomically(out, rewriteImports(code, file, new Set()));
  return import(pathToFileURL(out).href);
}
