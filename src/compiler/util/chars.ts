/** @module Character classes as Mermaid's lexers test them, over Unicode scalar values. */

/** Whitespace as JavaScript's `\s` matches it. */
export function isSpace(c: number): boolean {
  if (c < 128) return c === 32 || (c >= 9 && c <= 13)

  return (
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  )
}

/** Whether `text` contains `needle`. */
export function has(text: string, needle: string): boolean {
  return text.includes(needle)
}

/** A space or a tab. */
export function isBlank(c: number): boolean {
  return c === 32 || c === 9
}

/** A line terminator: what JavaScript's `.` does not match. */
export function isLineEnd(c: number): boolean {
  return c === 10 || c === 13 || c === 0x2028 || c === 0x2029
}

/** An ASCII digit. */
export function isDigit(c: number): boolean {
  return c >= 48 && c <= 57
}

/** An ASCII letter. */
export function isLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
}

/** An ASCII hexadecimal digit. */
export function isHex(c: number): boolean {
  return isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
}

/** A character of JavaScript's `\w`. */
export function isWord(c: number): boolean {
  return isDigit(c) || isLetter(c) || c === 95
}
