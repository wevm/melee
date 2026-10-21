/**
 * @module Case-insensitive word tests for hand-written lexers. Port of Pele's
 * `src/diagrams/common/caseless.ts`.
 */

/**
 * Whether `word`, written in lower case ASCII, is at UTF-16 offset `at` of `src`. Only ASCII
 * letters match in either case, as with the `i` flag on a regular expression without the `u`
 * flag.
 */
export function wordAt(src: string, at: number, word: string): boolean {
  for (let k = 0; k < word.length; k++) {
    if (at + k >= src.length) return false
    const c = src.charCodeAt(at + k)
    const w = word.charCodeAt(k)
    if (!(c === w || (w >= 0x61 && w <= 0x7a && c === w - 32))) return false
  }
  return true
}
