/**
 * @module Records the expected result of every parity case from Ondine's WebAssembly build.
 *
 * The module is built from wevm/ondine at `6a1586e5af980e67c104239593ae931837157b8b` with every
 * diagram type. `scripts/bench.ts` also reads a speed-optimized build, `core.fast.wasm`, made the
 * same way with `CARGO_PROFILE_WASM_OPT_LEVEL=3` and then `wasm-opt -O3`:
 *
 * ```sh
 * cargo build --package wasm --no-default-features --features all \
 *   --profile wasm --target wasm32-unknown-unknown
 * cp target/wasm32-unknown-unknown/wasm/wasm.wasm <this repo>/test/oracle/core.wasm
 * node scripts/oracle.ts
 * ```
 */
import * as Crypto from 'node:crypto'
import * as Fs from 'node:fs'
import * as Path from 'node:path'

import * as Cases from '../test/oracle/cases.ts'
import * as Wasm from '../test/oracle/Wasm.ts'

const root = Path.join(import.meta.dirname, '..')
const bytes = Fs.readFileSync(Path.join(root, 'test/oracle/core.wasm'))
const instance = Wasm.instantiate(new WebAssembly.Module(bytes))

const expected: Record<string, unknown> = {}
for (const entry of Cases.all()) {
  const result = instance.render(entry.source, entry.options, 0)
  if (!result.ok) {
    const { ok: _, ...error } = result
    expected[entry.name] = { ...error, ok: false }
    continue
  }

  // Full SVG is kept for the vectors themselves, and a digest for derived cases, which keeps
  // the fixture small. `pnpm oracle` reproduces any derived SVG for debugging.
  const derived = entry.name.includes('@') || entry.name.includes('#')
  const { svg, ...rest } = result
  expected[entry.name] = derived ? { ...rest, sha1: digest(svg) } : { ...rest, svg }
}

Fs.writeFileSync(Path.join(root, 'test/oracle/expected.json'), JSON.stringify(expected, null, 1) + '\n')
console.log(`Recorded ${Object.keys(expected).length} cases.`)

function digest(text: string): string {
  return Crypto.createHash('sha1').update(text).digest('hex')
}
