/**
 * @module Differential fuzzing against Ondine's WebAssembly build. Mutates the vectors at random
 * (line edits, token splices, character noise, option changes), renders each mutant with both
 * compilers, and reports any difference in SVG or errors.
 *
 * Usage: `node scripts/fuzz.ts [--count <mutants>] [--seed <n>] [--type <type,...>]`, where a type
 * is a vector file name such as `pie` or `git`. Without `--type`, every type is mutated. Exits non-zero on a mismatch and
 * writes the failing inputs to
 * `/tmp/ondine-fuzz-failures-<types>.json`.
 */
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as Util from 'node:util'

import { render, RenderError } from '../src/index.ts'
import * as Cases from '../test/oracle/cases.ts'
import * as Wasm from '../test/oracle/Wasm.ts'

const args = Util.parseArgs({
  options: {
    count: { default: '20000', type: 'string' },
    seed: { default: '1', type: 'string' },
    type: { type: 'string' },
  },
})

const wasm = Wasm.instantiate(
  new WebAssembly.Module(Fs.readFileSync(Path.join(import.meta.dirname, '../test/oracle/core.wasm'))),
)

const types = args.values.type?.split(',')
const sources = Cases.all()
  .filter((entry) => !entry.name.includes('@') && !entry.name.includes('#') && entry.name.split('/')[0] !== 'extra')
  .filter((entry) => types === undefined || types.includes(entry.name.split('/')[1] as string))
  .map((entry) => entry.source)
if (sources.length === 0) throw new Error(`No vectors for --type ${args.values.type}.`)
const failuresFile = `/tmp/ondine-fuzz-failures-${types?.join('-') ?? 'all'}.json`

const lines = sources.flatMap((source) => source.split('\n'))
const tokens = [
  ...new Set(sources.flatMap((source) => source.split(/(\s+|[[\](){}|"'`:;,&>-]+)/).filter(Boolean))),
]
const noise = ['\n', ' ', '"', '`', '[', ']', '(', ')', '{', '}', '|', '-->', '->>', '&', ';', ':', '%%', '#', '\t', '\r', 'é', '漢', '😀', '​', '\\', '<br>', '&amp;', '#35;']
const optionSets = [
  {},
  {},
  {},
  { maxWidth: 300 },
  { autoDirection: false, maxWidth: 300 },
  { fontSize: 11, padding: 3 },
  { idPrefix: 'q' },
  { responsive: false },
  { maxEdges: 3 },
  { links: false, images: false },
]

let state = Number(args.values.seed) >>> 0 || 1
function random(): number {
  // xorshift32, so runs reproduce from a seed.
  state ^= state << 13
  state >>>= 0
  state ^= state >>> 17
  state ^= state << 5
  state >>>= 0
  return state / 4294967296
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T

function mutate(source: string): string {
  let text = source
  const rounds = 1 + Math.floor(random() * 4)
  for (let r = 0; r < rounds; r++) {
    const parts = text.split('\n')
    const at = Math.floor(random() * parts.length)
    switch (Math.floor(random() * 8)) {
      case 0:
        parts.splice(at, 1)
        break
      case 1:
        parts.splice(at, 0, pick(lines))
        break
      case 2:
        parts.splice(at, 0, parts[at] ?? '')
        break
      case 3: {
        const other = Math.floor(random() * parts.length)
        ;[parts[at], parts[other]] = [parts[other] ?? '', parts[at] ?? '']
        break
      }
      case 4: {
        const line = parts[at] ?? ''
        const cut = Math.floor(random() * (line.length + 1))
        parts[at] = line.slice(0, cut) + pick(tokens) + line.slice(cut)
        break
      }
      case 5: {
        const line = parts[at] ?? ''
        const cut = Math.floor(random() * (line.length + 1))
        parts[at] = line.slice(0, cut) + pick(noise) + line.slice(cut + Math.floor(random() * 3))
        break
      }
      case 6: {
        const line = parts[at] ?? ''
        const cut = Math.floor(random() * (line.length + 1))
        parts[at] = line.slice(0, cut)
        break
      }
      default:
        parts.splice(at, 0, ...pick(sources).split('\n').slice(1, 4))
    }
    text = parts.join('\n')
  }
  return text
}

function viaTs(source: string, options: Record<string, unknown>): unknown {
  try {
    const result = render(source, { ...options, now: 0 })
    return { ...result, links: [...result.links], ok: true }
  } catch (error) {
    if (!(error instanceof RenderError)) return { crash: String(error instanceof Error ? error.stack : error) }
    return {
      code: error.code,
      column: error.column,
      line: error.line,
      message: error.message,
      ok: false,
      snippet: error.snippet,
      type: error.type,
    }
  }
}

function viaWasm(source: string, options: Record<string, unknown>): unknown {
  const json = Object.keys(options).length === 0 ? '' : JSON.stringify(options)
  const result = wasm.render(source, json, 0)
  if (!result.ok) return result
  return { height: result.height, links: result.links, ok: true, svg: result.svg, type: result.type, width: result.width }
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  )
}

const count = Number(args.values.count)
const failures: { options: Record<string, unknown>; source: string }[] = []
let rendered = 0
const start = performance.now()

for (let i = 0; i < count; i++) {
  const source = mutate(pick(sources))
  const options = pick(optionSets)
  const want = viaWasm(source, options)
  const got = viaTs(source, options)
  if ((want as { ok: boolean }).ok) rendered++
  if (canonical(got) !== canonical(want)) {
    failures.push({ options, source })
    if (failures.length <= 3) {
      console.log(`Mismatch #${failures.length}:`, JSON.stringify(source), JSON.stringify(options))
      console.log('  want:', canonical(want).slice(0, 300))
      console.log('  got: ', canonical(got).slice(0, 300))
    }
  }
}

console.log(
  `${count - failures.length}/${count} mutants match (${rendered} rendered, ${count - rendered} errors) in ${((performance.now() - start) / 1000).toFixed(1)}s.`,
)
if (failures.length > 0) {
  Fs.writeFileSync(failuresFile, JSON.stringify(failures, null, 1))
  process.exit(1)
}
