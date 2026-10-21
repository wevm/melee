/**
 * @module The inputs the parity suite renders: every vector, option variants of each, and each
 * line prefix of each, which exercises syntax errors and partial diagrams.
 */
import * as Fs from 'node:fs'
import * as Path from 'node:path'

/** One input to render. */
export type Case = {
  /** A stable, unique name. */
  readonly name: string
  /** Render options as JSON, or empty for defaults. */
  readonly options: string
  /** Mermaid source. */
  readonly source: string
}

const vectors = Path.join(import.meta.dirname, '../vectors')

/** Option sets each vector is also rendered with. */
const variants: readonly (readonly [string, Record<string, unknown>])[] = [
  ['narrow', { maxWidth: 320 }],
  ['narrow-fixed', { autoDirection: false, maxWidth: 320 }],
  ['styled', { fontSize: 12, idPrefix: 'x-', padding: 20 }],
  ['fixed', { responsive: false }],
  ['breakpoint', { directionBreakpoint: 2000, maxWidth: 900 }],
]

/** Inputs that probe limits, URLs, entities, and other edges of the pipeline. */
const extra: readonly (readonly [string, string, Record<string, unknown>])[] = [
  ['empty', '', {}],
  ['blank', '\n\n  \n', {}],
  ['unknown', 'notADiagram\n  A --> B\n', {}],
  ['limit', 'flowchart LR\n  A --> B\n', { limit: 10 }],
  ['output-limit', 'flowchart LR\n  A --> B\n', { outputLimit: 100 }],
  ['max-edges', 'flowchart LR\n  A & B & C --> D & E & F\n', { maxEdges: 4 }],
  ['entities', 'flowchart LR\n  A["#9829; &lt;b&gt; #amp; #35;"] --> B["fa:fa-car Car"]\n', {}],
  [
    'links',
    'flowchart LR\n  A --> B --> C\n  click A "https://example.com" "Tip" _blank\n  click B "javascript:alert(1)"\n  click C href "#section"\n',
    {},
  ],
  ['links-off', 'flowchart LR\n  A --> B\n  click A "https://example.com"\n', { links: false }],
  ['link-schemes', 'flowchart LR\n  A --> B\n  click A "ftp://example.com"\n', { linkSchemes: ['ftp'] }],
  ['link-rel', 'flowchart LR\n  A --> B\n  click A "https://example.com" _blank\n', { linkRel: 'nofollow' }],
  ['images', 'flowchart LR\n  A@{ img: "https://example.com/a.png", label: "Pic", w: 60, h: 60 }\n', {}],
  ['images-off', 'flowchart LR\n  A@{ img: "https://example.com/a.png", label: "Pic" }\n', { images: false }],
  ['wide-text', 'flowchart LR\n  A[漢字テキスト] --> B[😀 emoji]\n  B --> C[é combining]\n', {}],
  ['directive', '%%{init: {"flowchart": {"useMaxWidth": false}}}%%\nflowchart LR\n  A --> B\n', {}],
  ['front-matter-error', '---\nconfig: [\n---\nflowchart LR\n  A --> B\n', {}],
  ['title', '---\ntitle: Orders\n---\nsequenceDiagram\n  A->>B: hi\n', {}],
  ['acc', 'flowchart LR\n  accTitle: Title\n  accDescr: Description\n  A --> B\n', {}],
  ['sequence-autonumber', 'sequenceDiagram\n  autonumber\n  A->>B: one\n  B-->>A: two\n  Note over A,B: note\n', {}],
  ['sequence-error', 'sequenceDiagram\n  A->>: missing\n', {}],
  ['flowchart-error', 'flowchart LR\n  A --> (B\n', {}],
  ['crlf', 'flowchart LR\r\n  A --> B\r\n', {}],
]

/** Every case, in a stable order. */
export function all(): Case[] {
  const cases: Case[] = []
  const add = (name: string, source: string, options: Record<string, unknown> = {}) =>
    cases.push({ name, options: Object.keys(options).length === 0 ? '' : JSON.stringify(options), source })

  const bases: [string, string][] = []

  for (const file of Fs.readdirSync(Path.join(vectors, 'corpus')).sort()) {
    const type = file.replace(/\.json$/, '')
    const sources = JSON.parse(Fs.readFileSync(Path.join(vectors, 'corpus', file), 'utf8')) as string[]
    sources.forEach((source, i) => {
      add(`corpus/${type}/${i}`, source)
      bases.push([`corpus/${type}/${i}`, source])
    })
  }

  type Group = { samples: { label: string; source: string }[]; type: string }
  const samples = JSON.parse(Fs.readFileSync(Path.join(vectors, 'samples.json'), 'utf8')) as Group[]
  for (const group of samples)
    group.samples.forEach((sample, i) => {
      add(`samples/${group.type}/${i}`, sample.source)
      bases.push([`samples/${group.type}/${i}`, sample.source])
    })

  type Layout = Record<string, { cases: { source: string }[]; slug: string }[]>
  const layout = JSON.parse(Fs.readFileSync(Path.join(vectors, 'layout-cases.json'), 'utf8')) as Layout
  for (const [type, groups] of Object.entries(layout))
    for (const group of groups)
      group.cases.forEach((entry, i) => {
        add(`layout/${type}/${group.slug}/${i}`, entry.source)
        bases.push([`layout/${type}/${group.slug}/${i}`, entry.source])
      })

  for (const [name, source, options] of extra) add(`extra/${name}`, source, options)

  for (const [name, source] of bases) for (const [variant, options] of variants) add(`${name}@${variant}`, source, options)

  for (const [name, source] of bases) {
    const lines = source.split('\n')
    for (let i = 1; i < lines.length - 1; i++) add(`${name}#${i}`, lines.slice(0, i).join('\n') + '\n')
  }

  return cases
}
