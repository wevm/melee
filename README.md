# Ondine

Monochrome Mermaid diagrams, compiled with TypeScript. Now 100% stainless.

The compiler is a port of the Rust compiler it replaces and renders the same SVG, byte for byte, without WebAssembly. Mermaids and rust never mixed well anyway. Too much salt water.

```ts
import { render } from 'ondine'

// Compiles a diagram to SVG. Throws `RenderError` with Mermaid's diagnostics on bad input.
const { svg, width, height } = render('flowchart LR\n  A --> B')
```

## Current Status

Swimming along nicely.

- **Diagram types:** all 33 types of the Rust compiler, with the shared pipeline: preprocessing, front matter and directives, detection, YAML, text layout, the layered, compound, and lane layouts, shapes, edges, and SVG emission.
- **Source:** the Rust compiler at `6a1586e5af980e67c104239593ae931837157b8b`. `src/compiler/` mirrors the layout of its `crates/compiler/src`, one TypeScript module per Rust module.

## Verification

Trust, but verify. (Formerly: Rust, but verify.) Nobody has to take the port's word for anything:

| Check | Command | What it compares |
| --- | --- | --- |
| Parity | `pnpm test`, `pnpm test:dist` for the bundle | 12,935 cases against outputs recorded from the Rust compiler's WebAssembly build: every vector of every type, five option variants of each, and each line prefix of each (SVG, size, links, errors) |
| Fuzzing | `pnpm fuzz` | Random mutants of the vectors, rendered by both compilers and compared. `--type` limits it to some types |
| Types | `pnpm check:types` | TypeScript in strict mode |

`pnpm oracle` re-records the expected results. It needs `test/oracle/core.wasm`, built as described in `scripts/oracle.ts`.

## Performance

`pnpm bench` renders the vectors of each type with this package and with the Rust compiler built to WebAssembly, after checking that all of them emit the same SVG. The Rust compiler shipped its `opt-level = 3` build for Node and its `opt-level = "z"` builds for browsers. Median warm time per pass of the bundle from `pnpm build`, in Node 26.8 on Linux (16 threads):

| Type | Vectors | TypeScript | Rust, `opt-level = 3` | Rust, `opt-level = "z"` |
| --- | ---: | ---: | ---: | ---: |
| flowchart | 181 | 17.5 ms | 13.9 ms | 26.9 ms |
| sequence | 45 | 1.38 ms | 1.14 ms | 2.05 ms |
| class | 46 | 2.50 ms | 1.78 ms | 3.21 ms |
| state | 31 | 2.80 ms | 1.89 ms | 3.55 ms |
| git | 41 | 2.54 ms | 2.28 ms | 3.99 ms |
| usecase | 30 | 2.66 ms | 1.64 ms | 2.91 ms |
| sankey | 14 | 0.99 ms | 0.71 ms | 1.40 ms |
| venn | 14 | 0.90 ms | 1.00 ms | 1.54 ms |

Across all 33 types, the geometric mean time is 1.27 times that of the `opt-level = 3` module and 0.64 times that of the `opt-level = "z"` module. Every type renders faster than with the `opt-level = "z"` module, and four render faster than with the `opt-level = 3` module. `pnpm bench` prints every type.

In other words: browsers used to get the `opt-level = "z"` build, and TypeScript beats it on every single type. Turns out you don't have to be rusty to be quick.

| Measure | TypeScript | Rust, `opt-level = 3` | Rust, `opt-level = "z"` |
| --- | ---: | ---: | ---: |
| Cold start (load and first render) | 52 ms | 41 ms | 27 ms |
| Size | 313 kB gzip | 3.7 MB | 2.0 MB |

The WebAssembly sizes are uncompressed modules with every type. Cold start is the one lane where the water is still a little chilly.

## Licenses

[MIT](LICENSE). No borrowing required: you get to keep it. The compiler ports the Rust compiler, which ports Pele. Test vectors come from Mermaid and Pele ([test/vectors](test/vectors)).
