/**
 * @module Token kinds of the requirement lexer, the names Mermaid's parser reports for them, and
 * the keywords. Port of Pele's `src/diagrams/requirement/tokens.ts`.
 */

/**
 * A token kind. Variant order mirrors Pele's `T` enum, indexes {@link NAMES}, and gives the
 * ranges the parser tests, so it is observable.
 */
export const T = {
  /** Pele's `T.END`. */
  End: 0,
  /** Pele's `T.ERROR`. */
  Error: 1,
  /** Pele's `T.title`. */
  Title: 2,
  /** Pele's `T.acc_title`. */
  AccTitle: 3,
  /** Pele's `T.acc_title_value`. */
  AccTitleValue: 4,
  /** Pele's `T.acc_descr`. */
  AccDescr: 5,
  /** Pele's `T.acc_descr_value`. */
  AccDescrValue: 6,
  /** Pele's `T.acc_descr_multiline_value`. */
  AccDescrMultilineValue: 7,
  /** Pele's `T.direction_tb`. */
  DirectionTb: 8,
  /** Pele's `T.direction_bt`. */
  DirectionBt: 9,
  /** Pele's `T.direction_rl`. */
  DirectionRl: 10,
  /** Pele's `T.direction_lr`. */
  DirectionLr: 11,
  /** Pele's `T.NEWLINE`. */
  Newline: 12,
  /** Pele's `T.EOF`. */
  Eof: 13,
  /** Pele's `T.RD`. */
  Rd: 14,
  /** Pele's `T.STRUCT_START`. */
  StructStart: 15,
  /** Pele's `T.STRUCT_STOP`. */
  StructStop: 16,
  /** Pele's `T.STYLE_SEPARATOR`. */
  StyleSeparator: 17,
  /** Pele's `T.COLONSEP`. */
  Colonsep: 18,
  /** Pele's `T.ID`. */
  Id: 19,
  /** Pele's `T.TEXT`. */
  Text: 20,
  /** Pele's `T.RISK`. */
  Risk: 21,
  /** Pele's `T.VERIFYMTHD`. */
  Verifymthd: 22,
  /** Pele's `T.REQUIREMENT`. */
  Requirement: 23,
  /** Pele's `T.FUNCTIONAL_REQUIREMENT`. */
  FunctionalRequirement: 24,
  /** Pele's `T.INTERFACE_REQUIREMENT`. */
  InterfaceRequirement: 25,
  /** Pele's `T.PERFORMANCE_REQUIREMENT`. */
  PerformanceRequirement: 26,
  /** Pele's `T.PHYSICAL_REQUIREMENT`. */
  PhysicalRequirement: 27,
  /** Pele's `T.DESIGN_CONSTRAINT`. */
  DesignConstraint: 28,
  /** Pele's `T.LOW_RISK`. */
  LowRisk: 29,
  /** Pele's `T.MED_RISK`. */
  MedRisk: 30,
  /** Pele's `T.HIGH_RISK`. */
  HighRisk: 31,
  /** Pele's `T.VERIFY_ANALYSIS`. */
  VerifyAnalysis: 32,
  /** Pele's `T.VERIFY_DEMONSTRATION`. */
  VerifyDemonstration: 33,
  /** Pele's `T.VERIFY_INSPECTION`. */
  VerifyInspection: 34,
  /** Pele's `T.VERIFY_TEST`. */
  VerifyTest: 35,
  /** Pele's `T.ELEMENT`. */
  Element: 36,
  /** Pele's `T.CONTAINS`. */
  Contains: 37,
  /** Pele's `T.COPIES`. */
  Copies: 38,
  /** Pele's `T.DERIVES`. */
  Derives: 39,
  /** Pele's `T.SATISFIES`. */
  Satisfies: 40,
  /** Pele's `T.VERIFIES`. */
  Verifies: 41,
  /** Pele's `T.REFINES`. */
  Refines: 42,
  /** Pele's `T.TRACES`. */
  Traces: 43,
  /** Pele's `T.TYPE`. */
  Type: 44,
  /** Pele's `T.DOCREF`. */
  Docref: 45,
  /** Pele's `T.STYLE`. */
  Style: 46,
  /** Pele's `T.CLASSDEF`. */
  Classdef: 47,
  /** Pele's `T.CLASS`. */
  Class: 48,
  /** Pele's `T.ALPHA`. */
  Alpha: 49,
  /** Pele's `T.COLON`. */
  Colon: 50,
  /** Pele's `T.SEMICOLON`. */
  Semicolon: 51,
  /** Pele's `T.PERCENT`. */
  Percent: 52,
  /** Pele's `T.MINUS`. */
  Minus: 53,
  /** Pele's `T.BRKT`. */
  Brkt: 54,
  /** Pele's `T.END_ARROW_L`. */
  EndArrowL: 55,
  /** Pele's `T.END_ARROW_R`. */
  EndArrowR: 56,
  /** Pele's `T.LINE`. */
  Line: 57,
  /** Pele's `T.qString`. */
  QString: 58,
  /** Pele's `T.unqString`. */
  UnqString: 59,
  /** Pele's `T.COMMA`. */
  Comma: 60,
} as const

/** A token kind. */
export type T = (typeof T)[keyof typeof T]

/** The names Mermaid's parser reports for each token kind, indexed by {@link T}. */
export const NAMES: string[] = [
  '$end',
  'INVALID',
  'title',
  'acc_title',
  'acc_title_value',
  'acc_descr',
  'acc_descr_value',
  'acc_descr_multiline_value',
  'direction_tb',
  'direction_bt',
  'direction_rl',
  'direction_lr',
  'NEWLINE',
  'EOF',
  'RD',
  'STRUCT_START',
  'STRUCT_STOP',
  'STYLE_SEPARATOR',
  'COLONSEP',
  'ID',
  'TEXT',
  'RISK',
  'VERIFYMTHD',
  'REQUIREMENT',
  'FUNCTIONAL_REQUIREMENT',
  'INTERFACE_REQUIREMENT',
  'PERFORMANCE_REQUIREMENT',
  'PHYSICAL_REQUIREMENT',
  'DESIGN_CONSTRAINT',
  'LOW_RISK',
  'MED_RISK',
  'HIGH_RISK',
  'VERIFY_ANALYSIS',
  'VERIFY_DEMONSTRATION',
  'VERIFY_INSPECTION',
  'VERIFY_TEST',
  'ELEMENT',
  'CONTAINS',
  'COPIES',
  'DERIVES',
  'SATISFIES',
  'VERIFIES',
  'REFINES',
  'TRACES',
  'TYPE',
  'DOCREF',
  'STYLE',
  'CLASSDEF',
  'CLASS',
  'ALPHA',
  'COLON',
  'SEMICOLON',
  'PERCENT',
  'MINUS',
  'BRKT',
  'END_ARROW_L',
  'END_ARROW_R',
  'LINE',
  'qString',
  'unqString',
  'COMMA',
]

/** The name Mermaid's parser reports for `kind`. */
export function tName(kind: T): string {
  return NAMES[kind] ?? ''
}

/** The kind `offset` places after `kind`, as Pele adds to a `T` value. */
export function tOffset(kind: T, offset: number): T {
  const next = kind + offset
  return (next < NAMES.length ? next : T.End) as T
}

/** The kinds from `from` to `to`, inclusive. */
export function tThrough(from: T, to: T): T[] {
  const out: T[] = []
  for (let t = from; t <= to; t++) out.push(t as T)
  return out
}

/** `String.prototype.charCodeAt`, called through a constant to stay monomorphic (see `text/measure.ts`). */
const charCodeAt: (this: string, index: number) => number = String.prototype.charCodeAt

/** The keywords, lower-cased, and their kinds. */
const KEYWORDS: readonly (readonly [string, T])[] = [
  ['requirementdiagram', T.Rd],
  ['id', T.Id],
  ['text', T.Text],
  ['risk', T.Risk],
  ['verifymethod', T.Verifymthd],
  ['requirement', T.Requirement],
  ['functionalrequirement', T.FunctionalRequirement],
  ['interfacerequirement', T.InterfaceRequirement],
  ['performancerequirement', T.PerformanceRequirement],
  ['physicalrequirement', T.PhysicalRequirement],
  ['designconstraint', T.DesignConstraint],
  ['low', T.LowRisk],
  ['medium', T.MedRisk],
  ['high', T.HighRisk],
  ['analysis', T.VerifyAnalysis],
  ['demonstration', T.VerifyDemonstration],
  ['inspection', T.VerifyInspection],
  ['test', T.VerifyTest],
  ['element', T.Element],
  ['contains', T.Contains],
  ['copies', T.Copies],
  ['derives', T.Derives],
  ['satisfies', T.Satisfies],
  ['verifies', T.Verifies],
  ['refines', T.Refines],
  ['traces', T.Traces],
  ['type', T.Type],
  ['docref', T.Docref],
  ['style', T.Style],
  ['classdef', T.Classdef],
  ['class', T.Class],
]

/** The keywords by length. */
const BY_LENGTH: (readonly (readonly [string, T])[])[] = (() => {
  const out: (readonly [string, T])[][] = []
  for (const entry of KEYWORDS) {
    const len = entry[0].length
    while (out.length <= len) out.push([])
    ;(out[len] as (readonly [string, T])[]).push(entry)
  }
  return out
})()

/**
 * The keyword a lowercased word names. Every keyword is matched without regard to case and must
 * end at a word boundary.
 */
export function keyword(word: string): T | undefined {
  const list = BY_LENGTH[word.length]
  if (list === undefined) return undefined
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] as readonly [string, T]
    if (entry[0] === word) return entry[1]
  }
  return undefined
}

/**
 * The keyword `src` spells from `start` to `end`, ignoring ASCII case: `keyword` of the
 * lower-cased slice, without making it.
 */
export function keywordAt(src: string, start: number, end: number): T | undefined {
  const list = BY_LENGTH[end - start]
  if (list === undefined) return undefined
  for (let i = 0; i < list.length; i++) {
    const entry = list[i] as readonly [string, T]
    const word = entry[0]
    let same = true
    for (let k = 0; k < word.length; k++) {
      // Keywords are lower-case letters, and only the two cases of a letter set bit 5 to it.
      if ((charCodeAt.call(src, start + k) | 32) !== charCodeAt.call(word, k)) {
        same = false
        break
      }
    }
    if (same) return entry[1]
  }
  return undefined
}
