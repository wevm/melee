/**
 * @module Times cold start for `scripts/bench.ts` in a fresh process: loading an implementation,
 * compiling and instantiating it, and rendering one source read from standard input. It imports
 * nothing from the package statically, so loading is inside the measurement.
 */
import * as Fs from 'node:fs'
import * as Path from 'node:path'

const root = Path.join(import.meta.dirname, '..')
const name = process.argv[2]
const source = Fs.readFileSync(0, 'utf8')

const start = performance.now()

if (name === 'ts' || name === 'ts-bundle') {
  const file = name === 'ts' ? 'src/index.ts' : 'dist/index.js'
  const module = (await import(Path.join(root, file))) as typeof import('../src/index.ts')
  module.render(source, { now: 0 })
} else {
  const Wasm = await import('../test/oracle/Wasm.ts')
  const bytes = Fs.readFileSync(Path.join(root, 'test/oracle', name === 'wasm-fast' ? 'core.fast.wasm' : 'core.wasm'))
  const result = Wasm.instantiate(new WebAssembly.Module(bytes)).render(source, '', 0)
  if (!result.ok) throw new Error(result.message)
}

process.stdout.write(String(performance.now() - start))
