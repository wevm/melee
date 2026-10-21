/**
 * @module Fits a diagram to the width the host has, by narrowing a plot, turning its direction, or
 * tightening its spacing. Port of Pele's `src/diagrams/common/fit-width.ts`.
 *
 * The host options are `RenderOptions` from `svg/root.ts`.
 */
import type { RenderOptions } from '../../svg/root.ts'
import { fmax, fmin } from '../../util/rust.ts'

/** A drawn diagram, as far as fitting it is concerned. */
export type Drawn = {
  /** The drawn width. */
  readonly width: number
}

/** The width the host has, when it set a positive one. */
function available(options: RenderOptions): number | undefined {
  const width = options.maxWidth
  return width !== undefined && width > 0 ? width : undefined
}

/**
 * Draws a chart whose plot can be any width so the whole diagram fits the width the host has.
 * What surrounds the plot (labels, a legend) is only known once it is drawn, so the plot gives up
 * the overflow and is drawn again, down to `least`. `draw` takes the plot width and whether the
 * chart did not fit at its `natural` width, for a chart that then arranges itself differently.
 */
export function fitWidth<R extends Drawn>(
  options: RenderOptions,
  natural: number,
  least: number,
  draw: (plot: number, overflowed: boolean) => R,
): R {
  const first = draw(natural, false)
  const room = available(options)
  if (room === undefined || !(first.width > room)) return first

  const floor = fmin(least, natural)
  let plot = natural
  let result = draw(plot, true)
  let round = 0
  while (round < 3 && result.width > room && plot > floor) {
    plot = fmax(floor, plot - (result.width - room))
    result = draw(plot, true)
    round += 1
  }
  return result
}

/** The width a title may take before it wraps. */
export function titleRoom(options: RenderOptions): number {
  const room = available(options)
  if (room === undefined) return 4000
  return fmax(80, room - 2 * (options.padding ?? 8))
}

/**
 * For a chart drawn to a set width: its `natural` one, or the host's when that is smaller, down
 * to `least`. `around` is what the chart adds outside that width.
 */
export function capWidth(options: RenderOptions, natural: number, least: number, around: number): number {
  const room = available(options)
  if (room === undefined) return natural
  return fmax(fmin(least, natural), fmin(natural, room - around))
}

/** The width under which a diagram may turn to run down. */
const BREAKPOINT = 640

/**
 * For a diagram that can run across or down: draws it across, and down instead when the host
 * allows it, the width it has is under the breakpoint, across does not fit, and down is narrower.
 */
export function turnToFit<R extends Drawn>(options: RenderOptions, draw: (down: boolean) => R): R {
  const across = draw(false)
  const room = available(options)
  if (room === undefined) return across
  if (options.autoDirection === false || across.width <= room) return across

  const b = options.directionBreakpoint
  const breakpoint = b !== undefined && b > 0 ? b : BREAKPOINT
  if (room >= breakpoint) return across
  const down = draw(true)
  return down.width < across.width ? down : across
}

/** Whether a direction runs across. */
export function runsAcross(direction: string | undefined): boolean {
  return direction === 'LR' || direction === 'RL'
}

/**
 * Draws a diagram with room to spare, and tightly instead when that does not fit the width the
 * host has and tight is narrower.
 */
export function tighten<R extends Drawn>(options: RenderOptions, draw: (tight: boolean) => R): R {
  const loose = draw(false)
  const room = available(options)
  if (!(room !== undefined && loose.width > room)) return loose

  const tight = draw(true)
  return tight.width < loose.width ? tight : loose
}
