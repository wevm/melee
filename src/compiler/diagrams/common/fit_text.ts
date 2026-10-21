/** @module Fits one line of text into a width. Port of Pele's `src/diagrams/common/fit-text.ts`. */
import { trimEnd } from '../../text/label.ts'
import * as measure from '../../text/measure.ts'
import { fmax } from '../../util/rust.ts'

/** Text fitted into a width. */
export type Fitted = {
  /** Font size. */
  size: number
  /** The text, cut and ended with an ellipsis when it did not fit whole. */
  text: string
  /** The measured width. */
  width: number
}

/**
 * Fits `text` into `max`: first by shrinking the font from `size` down to `min`, then by
 * cutting the text and adding an ellipsis. Returns `undefined` when not even one character fits.
 */
export function fitText(text: string, max: number, size: number, min: number, style: number): Fitted | undefined {
  if (text === '' || max <= 0) return undefined
  let width = measure.width(text, size, style)
  if (width <= max) return { size, text, width }

  // Width grows with font size, so one division lands on the right size or just above it.
  let fitted = fmax(min, Math.floor((size * max) / width))
  while (fitted >= min) {
    width = measure.width(text, fitted, style)
    if (width <= max) return { size: fitted, text, width }
    fitted -= 1
  }

  // UTF-16 offsets after each character, so a cut of `k` characters is `text.slice(0, ends[k - 1])`.
  const ends: number[] = []
  for (let at = 0; at < text.length; ) {
    at += (text.codePointAt(at) as number) > 0xffff ? 2 : 1
    ends.push(at)
  }
  const cut = (count: number): string => {
    const end = count >= 1 ? (ends[count - 1] ?? 0) : 0
    return `${trimEnd(text.slice(0, end))}…`
  }

  let low = 0
  let high = Math.max(ends.length - 1, 0)
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (measure.width(cut(mid), min, style) <= max) low = mid
    else high = mid - 1
  }
  if (low === 0) return undefined

  const cutText = cut(low)
  width = measure.width(cutText, min, style)
  return width <= max ? { size: min, text: cutText, width } : undefined
}
