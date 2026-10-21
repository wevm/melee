/** @module Generic type notation with tildes. Port of Pele's `src/diagrams/common/generics.ts`. */

function tildes(text: string): number {
  let count = 0
  for (let at = text.indexOf('~'); at !== -1; at = text.indexOf('~', at + 1)) count++
  return count
}

/** Pairs tildes from the outside in: the first with the last, the second with the one before it. */
function pairTildes(text: string): string {
  const count = tildes(text)
  if (count <= 1) return text

  const lead = count % 2 !== 0 && text.startsWith('~')
  const chars = Array.from(text)
  const at: number[] = []
  for (let i = lead ? 1 : 0; i < chars.length; i++) {
    if (chars[i] === '~') at.push(i)
  }
  const half = at.length >> 1
  for (let k = 0; k < half; k++) {
    chars[at[k] as number] = '<'
    chars[at[at.length - 1 - k] as number] = '>'
  }
  return chars.join('')
}

/**
 * Turns `List~int~` into `List<int>`, with the quirks of Mermaid's `parseGenericTypes` around
 * commas.
 */
export function parseGenericTypes(input: string): string {
  if (!input.includes('~')) return input

  // `input.split(/(,)/)`: the pieces between commas, with each comma kept as a piece.
  const sets: string[] = []
  const pieces = input.split(',')
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) sets.push(',')
    sets.push(pieces[i] as string)
  }

  const output: string[] = []
  let i = 0
  while (i < sets.length) {
    const set = sets[i] as string
    let joined: string | undefined
    if (set === ',' && i > 0) {
      const before = sets[i - 1]
      const after = sets[i + 1]
      if (before !== undefined && after !== undefined && tildes(before) === 1 && tildes(after) === 1) {
        i += 1
        output.pop()
        joined = `${before},${after}`
      }
    }
    output.push(pairTildes(joined ?? set))
    i += 1
  }
  return output.join('')
}
