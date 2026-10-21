/**
 * @module Checks that the TypeScript compiler renders every parity case exactly as Ondine's
 * WebAssembly build does: the same SVG bytes, sizes, links, and errors. It checks the source, or
 * the bundle when `ONDINE_ENTRY` names it.
 */
import * as Crypto from 'node:crypto'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import { describe, expect, test } from 'vitest'

import * as Cases from './oracle/cases.ts'

// `ONDINE_ENTRY=../dist/index.js` checks the built bundle instead of the source.
const { render, RenderError } = (await import(process.env.ONDINE_ENTRY ?? '../src/index.ts')) as typeof import('../src/index.ts')

type Expected =
  | {
      height: number
      links: { href: string; id: string; internal: boolean }[]
      ok: true
      sha1?: string
      svg?: string
      type: string
      width: number
    }
  | {
      code: string
      column: number
      line: number
      message: string
      ok: false
      snippet: string
      type?: string
    }

const expected = JSON.parse(
  Fs.readFileSync(Path.join(import.meta.dirname, 'oracle/expected.json'), 'utf8'),
) as Record<string, Expected>

describe('render', () => {
  test.each(Cases.all().map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const want = expected[entry.name]
    if (want === undefined) throw new Error(`No recorded result for ${entry.name}. Run \`pnpm oracle\`.`)

    const options = entry.options === '' ? {} : JSON.parse(entry.options)
    const got = (() => {
      try {
        const result = render(entry.source, { ...options, now: 0 })
        const { svg, ...rest } = result
        return {
          ...rest,
          links: [...result.links],
          ok: true as const,
          ...(want.ok && want.sha1 !== undefined ? { sha1: digest(svg) } : { svg }),
        }
      } catch (error) {
        if (!(error instanceof RenderError)) throw error
        return {
          code: error.code,
          column: error.column,
          line: error.line,
          message: error.message,
          ok: false as const,
          snippet: error.snippet,
          ...(error.type === undefined ? {} : { type: error.type }),
        }
      }
    })()

    expect(got).toEqual(want)
  })
})

function digest(text: string): string {
  return Crypto.createHash('sha1').update(text).digest('hex')
}
