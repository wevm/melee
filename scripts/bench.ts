/**
 * @module Compares render speed of the TypeScript compiler with Ondine's Rust compiler built to
 * WebAssembly, over the vectors of every diagram type.
 *
 * - `ts`: this package's source modules.
 * - `ts-bundle`: `dist/index.js` from `pnpm build`, the published form.
 * - `wasm-fast`: `test/oracle/core.fast.wasm`, built like Ondine's Node module (`opt-level = 3`,
 *   `wasm-opt -O3`).
 * - `wasm-size`: `test/oracle/core.wasm`, built like Ondine's browser modules (`opt-level = "z"`).
 *
 * Each lane first checks that every implementation returns the same SVG, then times warm passes
 * over all of its sources. Cold start (module load, instantiation, and one render) is timed in
 * fresh processes by `scripts/cold.ts`. Usage:
 * `node scripts/bench.ts [--time <ms per lane>] [--cold <runs>] [--only <impl>] [--type <type,...>]`.
 * A type without vectors that every implementation renders has no lane.
 */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as Util from 'node:util'

import { render } from '../src/index.ts'
import * as Cases from '../test/oracle/cases.ts'
import * as Wasm from '../test/oracle/Wasm.ts'

const root = Path.join(import.meta.dirname, '..')

const args = Util.parseArgs({
  options: {
    cold: { default: '5', type: 'string' },
    only: { type: 'string' },
    type: { type: 'string' },
    time: { default: '3000', type: 'string' },
  },
})

type Impl = { name: string; render: (source: string) => string }

const impls = await Promise.all(
  ['ts', 'ts-bundle', 'wasm-fast', 'wasm-size']
    .filter((name) => args.values.only === undefined || name === args.values.only)
    .map(load),
)

const allTypes = [
  ...new Set(
    Cases.all()
      .filter((entry) => !entry.name.startsWith('extra/'))
      .map((entry) => entry.name.split('/')[1] as string),
  ),
].sort()
const selected = args.values.type?.split(',') ?? allTypes

const lanes = selected.map((type) => {
  // The vectors themselves, without derived variants or prefixes.
  const sources = Cases.all()
    .filter((entry) => !entry.name.includes('@') && !entry.name.includes('#') && entry.name.split('/')[1] === type)
    .map((entry) => entry.source)
    .filter((source) => {
      try {
        const outputs = impls.map((impl) => impl.render(source))
        if (outputs.some((svg) => svg !== outputs[0])) throw new Error(`Implementations disagree on:\n${source}`)
        return true
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Implementations disagree')) throw error
        return false
      }
    })
  return { sources, type }
}).filter((lane) => lane.sources.length > 0)

const budget = Number(args.values.time)
const rows: string[][] = []

for (const lane of lanes) {
  for (const impl of impls) {
    const samples = measure(() => {
      for (const source of lane.sources) impl.render(source)
    }, budget)
    rows.push([
      lane.type,
      String(lane.sources.length),
      impl.name,
      ms(quantile(samples, 0.5)),
      ms(quantile(samples, 0.95)),
      String(samples.length),
    ])
  }
}

console.log(table(['Type', 'Vectors', 'Impl', 'Median (ms)', 'p95 (ms)', 'Samples'], rows))

const coldRuns = Number(args.values.cold)
if (coldRuns > 0) {
  const source = lanes[0]?.sources[0] ?? 'flowchart LR\n  A --> B\n'
  const coldRows = impls.map((impl) => {
    const times = Array.from({ length: coldRuns }, () =>
      Number(
        ChildProcess.execFileSync(process.execPath, [Path.join(import.meta.dirname, 'cold.ts'), impl.name], {
          input: source,
        }).toString(),
      ),
    )
    return [impl.name, ms(quantile(times, 0.5)), String(coldRuns)]
  })
  console.log()
  console.log(table(['Impl', 'Cold start (ms)', 'Runs'], coldRows))
}

async function load(name: string): Promise<Impl> {
  if (name === 'ts') return { name, render: (source) => render(source, { now: 0 }).svg }
  if (name === 'ts-bundle') {
    const bundle = (await import(Path.join(root, 'dist/index.js'))) as { render: typeof render }
    return { name, render: (source) => bundle.render(source, { now: 0 }).svg }
  }

  const file = name === 'wasm-fast' ? 'core.fast.wasm' : 'core.wasm'
  const bytes = Fs.readFileSync(Path.join(root, 'test/oracle', file))
  const instance = Wasm.instantiate(new WebAssembly.Module(bytes))
  return {
    name,
    render(source) {
      const result = instance.render(source, '', 0)
      if (!result.ok) throw new Error(result.message)
      return result.svg
    },
  }
}

/** Runs `fn` repeatedly for about `budget` milliseconds after a warmup, returning each run's time. */
function measure(fn: () => void, budget: number): number[] {
  const warmup = performance.now() + Math.min(1000, budget / 3)
  while (performance.now() < warmup) fn()

  const samples: number[] = []
  const end = performance.now() + budget
  while (performance.now() < end || samples.length < 10) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  return samples
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN
}

function ms(value: number): string {
  return value >= 10 ? value.toFixed(2) : value.toPrecision(3)
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = head.map((cell, i) => Math.max(cell.length, ...rows.map((row) => row[i]?.length ?? 0)))
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell, i) => (i < 2 && cells !== head ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0))).join(' | ')} |`
  return [line(head), `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`, ...rows.map(line)].join('\n')
}
