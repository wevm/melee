/**
 * @module Class members: an attribute or a method line split into its parts. Port of Pele's
 * `src/diagrams/class/members.ts`.
 */
import { parseGenericTypes } from '../common/generics.ts'
import { trim } from '../../text/label.ts'
import { isLineEnd, isSpace } from '../../util/chars.ts'

/** Whether a member is a method or an attribute. */
export const MemberType = {
  /** A field. */
  Attribute: 'Attribute',
  /** A method, written with parentheses. */
  Method: 'Method',
} as const

export type MemberType = (typeof MemberType)[keyof typeof MemberType]

/** The name Pele uses. */
export function memberTypeAsStr(self: MemberType): string {
  return self === MemberType.Attribute ? 'attribute' : 'method'
}

/** A parsed member line: Pele's `ClassMember`. */
export type ClassMember = {
  /** `$` (static), `*` (abstract), or empty. */
  classifier: string
  /** The name, or for an attribute everything but its markers. */
  id: string
  /** Whether the member is a method or an attribute. */
  memberType: MemberType
  /** A method's parameters. */
  parameters: string
  /** A method's return type. */
  returnType: string
  /** `#`, `+`, `~`, `-`, or empty. */
  visibility: string
}

/** Whether `c` is a visibility marker. */
function isVisibility(c: number): boolean {
  return c === 0x23 || c === 0x2b || c === 0x7e || c === 0x2d
}

/** The end of the line that starts at `from`. */
function lineEnd(input: string, from: number): number {
  for (let i = from; i < input.length; i++) {
    if (isLineEnd(input.charCodeAt(i))) return i
  }
  return input.length
}

/** Parses `input` as a member of `memberType`. */
export function classMemberNew(input: string, memberType: MemberType): ClassMember {
  const member: ClassMember = {
    classifier: '',
    id: '',
    memberType,
    parameters: '',
    returnType: '',
    visibility: '',
  }
  // Mermaid throws a TypeError for a method with no opening parenthesis, such as `run)`.
  // It is kept here as an attribute, so it is shown as written.
  if (memberType !== MemberType.Method || !parseMethod(member, input)) {
    parseAttribute(member, input)
  }
  member.id = member.id.startsWith(' ') ? ` ${trim(member.id)}` : trim(member.id)
  return member
}

/**
 * The same split as Mermaid's `/([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?/`, found in one
 * pass: the first line with an opening parenthesis after its first character and a closing
 * one later.
 */
function parseMethod(self: ClassMember, input: string): boolean {
  const n = input.length
  let start = 0
  while (start < n) {
    const end = lineEnd(input, start)
    let close: number | undefined
    for (let i = end - 1; i >= start + 1; i--) {
      if (input.charCodeAt(i) === 0x29) {
        close = i
        break
      }
    }
    let open: number | undefined
    if (close !== undefined) {
      for (let i = close - 1; i >= start + 1; i--) {
        if (input.charCodeAt(i) === 0x28) {
          open = i
          break
        }
      }
    }
    if (close !== undefined && open !== undefined) {
      const visible = isVisibility(input.charCodeAt(start)) && open > start + 1
      if (visible) self.visibility = input.slice(start, start + 1)
      self.id = input.slice(visible ? start + 1 : start, open)
      self.parameters = trim(input.slice(open + 1, close))

      let rest = close + 1
      let classifier = ''
      if (rest < n) {
        const next = input.charCodeAt(rest)
        if (next === 0x24 || next === 0x2a || isSpace(next)) {
          if (!isSpace(next)) classifier += input[rest]
          rest += 1
        }
      }
      const stop = lineEnd(input, rest)
      self.returnType = trim(input.slice(rest, stop))
      if (classifier === '') {
        const last = self.returnType.charCodeAt(self.returnType.length - 1)
        if (last === 0x24 || last === 0x2a) {
          classifier += self.returnType[self.returnType.length - 1]
          self.returnType = self.returnType.slice(0, -1)
        }
      }
      self.classifier = classifier
      return true
    }
    start = end + 1
  }
  self.memberType = MemberType.Attribute
  return false
}

/** Splits an attribute into its visibility, name, and classifier. */
function parseAttribute(self: ClassMember, input: string): void {
  if (input.length > 0 && isVisibility(input.charCodeAt(0))) {
    self.visibility = input.slice(0, 1)
  }
  const last = input.charCodeAt(input.length - 1)
  if (last === 0x24 || last === 0x2a) {
    self.classifier = input[input.length - 1] ?? ''
  }
  const from = self.visibility === '' ? 0 : 1
  const to = self.classifier === '' ? input.length : input.length - 1
  self.id = input.slice(Math.min(from, to), Math.max(to, from))
}

/** The text shown for the member, as Pele's `getDisplayDetails().displayText`. */
export function classMemberDisplayText(self: ClassMember): string {
  let text = self.visibility
  text += parseGenericTypes(self.id)
  if (self.memberType === MemberType.Method) {
    text += '('
    text += parseGenericTypes(trim(self.parameters))
    text += ')'
    if (self.returnType !== '') {
      text += ' : '
      text += parseGenericTypes(self.returnType)
    }
  }
  return trim(text)
}
