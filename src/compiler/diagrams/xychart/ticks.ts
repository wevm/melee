/** @module Tick steps and values for numeric axes. Port of Pele's `src/diagrams/xychart/ticks.ts`. */
import { pushU32 } from '../../error.ts'
import { jsRound } from '../../svg/builder.ts'
import { parse } from '../../util/float.ts'
import { asUint, buf, fmax } from '../../util/rust.ts'

/** `10 ** power` for a whole `power`, correctly rounded as V8 computes it. */
function pow10(power: number): number {
  if (Number.isNaN(power)) return Number.NaN
  if (power > 400) return Number.POSITIVE_INFINITY
  if (power < -400) return 0
  const text = buf('1e')
  if (power < 0) text.s += '-'
  // The bounds above keep the magnitude a small whole number.
  const magnitude = asUint(Math.abs(power))
  pushU32(text, magnitude)
  return parse(text.s) ?? Number.NaN
}

/**
 * A step of 1, 2 or 5 times a power of ten that divides `span` into about `count` parts. A step
 * below one comes back as the negative of its inverse, which is a whole number, so that tick
 * values are found by division and print without rounding noise (0.3, not 0.30000000000000004).
 */
export function tickStep(span: number, count: number): number {
  const raw = span / fmax(count, 1)
  const power = Math.floor(Math.log10(raw))
  const unit = raw / pow10(power)
  const factor = unit >= 7.07 ? 10 : unit >= 3.16 ? 5 : unit >= 1.41 ? 2 : 1
  if (power < 0) return -pow10(-power) / factor
  return factor * pow10(power)
}

/** The index of `value` among the multiples of `step`. */
export function tickIndex(step: number, value: number): number {
  if (step > 0) return value / step
  return value * -step
}

/** The multiple `index` of `step`. */
export function tickValue(step: number, index: number): number {
  if (step > 0) return index * step
  return index / -step
}

/** The multiples of a step from `lo` to `hi`, both included, at most 100 of them. */
export function ticksBetween(lo: number, hi: number, step: number): number[] {
  let first = jsRound(tickIndex(step, lo))
  if (tickValue(step, first) < lo) first += 1
  let last = jsRound(tickIndex(step, hi))
  if (tickValue(step, last) > hi) last -= 1
  const out: number[] = []
  let i = first
  while (i <= last && out.length < 100) {
    out.push(tickValue(step, i))
    i += 1
  }
  return out
}
