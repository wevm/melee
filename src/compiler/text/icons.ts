/**
 * @module Host icons for labels. Port of Pele's `src/text/icons.ts`.
 *
 * Pele keeps the host's resolver in module state for the render in progress and memoizes its
 * answers. Ondine has no module state: every function that lays out or draws a label takes the
 * resolver as an explicit `IconResolver | undefined` argument, and `undefined` means the host has
 * no icons. A host that wants answers memoized does so inside its own closure.
 */

/**
 * Returns the SVG markup of a host icon by name, such as `fa:fa-car`, or `undefined` when the
 * host has no icon by that name.
 */
export type IconResolver = (name: string) => string | undefined

/**
 * The markup of the icon `name`, or an empty string when there is no resolver or it has no such
 * icon. A label leaves room for an icon only when this is not empty.
 */
export function iconMarkup(icons: IconResolver | undefined, name: string): string {
  return (icons === undefined ? undefined : icons(name)) ?? ''
}
