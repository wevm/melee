/**
 * @module The `accDescr` token type for grammars where `accDescr` is also a name. Port of Pele's
 * `src/diagrams/common/accDescr.ts`.
 */
import { ACC_DESCR, type Memo, type TokenType, accDescrHead } from './tokens.ts'

/**
 * The common `accDescr` token type, named `name` (Pele's default is `ACC_DESCR`). Lexing goes
 * on after an `accDescr {` that never closes, and each one would otherwise read to the end of
 * the text.
 */
export function accDescr(name: string): TokenType {
  return {
    ...ACC_DESCR,
    longer: ACC_DESCR.longer.slice(),
    name,
    pattern: { kind: 'Scan', _0: scan },
  }
}

/**
 * The braced form scans for its closing brace. Once none is found there is none further on, so
 * later braced descriptions fail without scanning the rest of the text again. `memo[0]` is 1
 * once a brace was found unclosed.
 */
function scan(src: string, at: number, memo: Memo): number | undefined {
  const head = accDescrHead(src, at)
  if (head === undefined) return undefined
  const [end, braced] = head
  if (!braced) return end
  if (memo[0] !== 0) return undefined

  const close = end <= src.length ? src.indexOf('}', end) : -1
  memo[0] = close < 0 ? 1 : 0
  return close < 0 ? undefined : close + 1
}
