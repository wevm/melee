/**
 * @module Shares one string per distinct text. A parser that interns the names it reads hands the
 * same string to every map keyed by a name, so V8 computes each name's hash once instead of once
 * per mention. Looking a string up here hashes it in JavaScript, which is several times cheaper
 * for a short fresh string than the hash V8 computes on its first use as a key.
 */

/** A set of strings by content. */
export type Interner = {
  /** Open-addressed slots, `undefined` where empty. The length is a power of two. */
  slots: (string | undefined)[]
  size: number
}

/** An empty interner. */
export function internerNew(): Interner {
  return { slots: new Array<string | undefined>(16).fill(undefined), size: 0 }
}

function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** The string equal to `text` that was interned first, or `text` itself when it is new. */
export function intern(self: Interner, text: string): string {
  let slots = self.slots
  let mask = slots.length - 1
  let at = hash(text) & mask
  for (;;) {
    const slot = slots[at]
    if (slot === undefined) break
    if (slot === text) return slot
    at = (at + 1) & mask
  }
  slots[at] = text
  self.size += 1
  if (self.size * 2 > slots.length) {
    const old = slots
    slots = new Array<string | undefined>(old.length * 2).fill(undefined)
    mask = slots.length - 1
    for (const key of old) {
      if (key === undefined) continue
      let i = hash(key) & mask
      while (slots[i] !== undefined) i = (i + 1) & mask
      slots[i] = key
    }
    self.slots = slots
  }
  return text
}
