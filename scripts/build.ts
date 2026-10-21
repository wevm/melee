/**
 * @module Bundles the package into one minified ES module, `dist/index.js`. One file loads faster
 * than the source modules, which Node would otherwise resolve and strip of types one at a time.
 *
 * Rolldown keeps top-level `const` bindings. esbuild turns them into `var` when it bundles, and V8
 * then no longer treats module constants such as the `charCodeAt` aliases in `text/measure.ts` as
 * constant, which made the bundle up to 18% slower than the source.
 */
import * as Path from 'node:path'
import { build } from 'rolldown'

const root = Path.join(import.meta.dirname, '..')

await build({
  input: Path.join(root, 'src/index.ts'),
  logLevel: 'warn',
  output: { file: Path.join(root, 'dist/index.js'), format: 'esm', minify: true },
  platform: 'neutral',
})
