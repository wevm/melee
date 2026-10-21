/**
 * @module Turns the syntax tree into the model the renderer draws, in Mermaid's order. Port of
 * Pele's `src/diagrams/wardley/model.ts`.
 */
import { Code, type CompileError, errorNew } from '../../error.ts'
import { trim, trimStart } from '../../text/label.ts'
import { isSpace } from '../../util/chars.ts'
import { buf } from '../../util/rust.ts'
import { pushNumber } from '../../yaml.ts'
import {
  Flow,
  type WardleyBuildResult,
  type WardleyBuilder,
  wardleyBuilderAddAccelerator,
  wardleyBuilderAddAnnotation,
  wardleyBuilderAddDeaccelerator,
  wardleyBuilderAddLink,
  wardleyBuilderAddNode,
  wardleyBuilderAddNote,
  wardleyBuilderAddPipelineComponent,
  wardleyBuilderAddTrend,
  wardleyBuilderBuild,
  wardleyBuilderDefault,
  wardleyBuilderGetNode,
  wardleyBuilderResolveNodeId,
  wardleyBuilderSetAnnotationsBox,
  wardleyBuilderSetAxes,
  wardleyBuilderSetSize,
  wardleyBuilderStartPipeline,
} from './builder.ts'
import type { LabelAst, WardleyAst } from './parser.ts'

/** The parsed map: Pele's `WardleyModel`. */
export type WardleyModel = {
  /** The accessible description. */
  accDescr: string | undefined
  /** The accessible title. */
  accTitle: string | undefined
  /** What the builder collected. */
  build: WardleyBuildResult
  /** The title. */
  title: string | undefined
}

function semantic(message: string): CompileError {
  const error = errorNew(Code.Semantic, message)
  error.type = 'wardley'
  return error
}

/** `value` in percent: values up to 1 are fractions, larger ones are already percentages. */
function toPercent(value: number, context: string): number {
  const normalized = value <= 1 ? value * 100 : value
  // NaN passes, as in JavaScript.
  if (normalized < 0 || normalized > 100) {
    const message = buf(context)
    message.s += ' must be between 0-1 (decimal) or 0-100 (percentage). Received: '
    pushNumber(message, value)
    throw semantic(message.s)
  }
  return normalized
}

/** `context` followed by `suffix`. */
function join(context: string, suffix: string): string {
  return context + suffix
}

/** `(x, y)` in percent from a visibility and an evolution. Evolution is checked first. */
function toCoordinates(visibility: number, evolution: number, context: string): [number, number] {
  const x = toPercent(evolution, join(context, ' evolution'))
  const y = toPercent(visibility, join(context, ' visibility'))
  return [x, y]
}

/** Whether {@link toPercent} takes `value` without an error. */
function inRange(value: number): boolean {
  const normalized = value <= 1 ? value * 100 : value
  return !(normalized < 0 || normalized > 100)
}

/**
 * {@link toCoordinates} with the context {@link quoted} from `prefix` and `name`, written out
 * only for an error.
 */
function toCoordinatesOf(visibility: number, evolution: number, prefix: string, name: string): [number, number] {
  if (inRange(evolution) && inRange(visibility)) {
    return [evolution <= 1 ? evolution * 100 : evolution, visibility <= 1 ? visibility * 100 : visibility]
  }
  return toCoordinates(visibility, evolution, quoted(prefix, name))
}

/** `{prefix}"{name}"`. */
function quoted(prefix: string, name: string): string {
  return `${prefix}"${name}"`
}

function flowFromPort(port: string | undefined): Flow | undefined {
  switch (port) {
    case '+<>':
      return Flow.Bidirectional
    case '+<':
      return Flow.Backward
    case '+>':
      return Flow.Forward
    default:
      return undefined
  }
}

/** The flow and quoted label of an arrow like `+'label'>`. */
function flowFromArrow(arrow: string | undefined): [Flow | undefined, string | undefined] {
  if (arrow === undefined || !arrow.startsWith('+')) return [undefined, undefined]
  let label: string | undefined
  if (arrow.charCodeAt(1) === 0x27) {
    const found = arrow.indexOf("'", 2)
    if (found >= 0) label = arrow.slice(2, found)
  }
  let flow: Flow | undefined
  if (arrow.includes('<>')) flow = Flow.Bidirectional
  else if (arrow.includes('<')) flow = Flow.Backward
  else if (arrow.includes('>')) flow = Flow.Forward
  return [flow, label]
}

function offsets(label: LabelAst | undefined): [number | undefined, number | undefined] {
  if (label === undefined) return [undefined, undefined]
  const sign = (neg: boolean): number => (neg ? -1 : 1)
  return [sign(label.negX) * label.offsetX, sign(label.negY) * label.offsetY]
}

/**
 * Mermaid's `populateDb`: fills the builder from the syntax tree, in Mermaid's order.
 *
 * @throws {CompileError} A semantic error for a coordinate out of range or a pipeline without a
 * component.
 */
export function populate(ast: WardleyAst, db: WardleyBuilder): void {
  if (ast.size !== undefined) {
    const [width, height] = ast.size
    wardleyBuilderSetSize(db, width, height)
  }

  const stages = ast.evolution
  if (stages !== undefined) {
    const boundaries: number[] = []
    for (const stage of stages) if (stage.boundary !== undefined) boundaries.push(stage.boundary)
    wardleyBuilderSetAxes(db, {
      stageBoundaries: boundaries,
      stages: stages.map((stage) =>
        stage.secondName !== undefined
          ? `${trim(stage.name)} / ${trim(stage.secondName)}`
          : trim(stage.name),
      ),
    })
  }

  for (const anchor of ast.anchors) {
    const [x, y] = toCoordinatesOf(anchor.visibility, anchor.evolution, 'Anchor ', anchor.name)
    wardleyBuilderAddNode(db, {
      className: 'anchor',
      id: anchor.name,
      inertia: undefined,
      label: anchor.name,
      labelOffsetX: undefined,
      labelOffsetY: undefined,
      sourceStrategy: undefined,
      x,
      y,
    })
  }

  for (const component of ast.components) {
    const [x, y] = toCoordinatesOf(component.visibility, component.evolution, 'Component ', component.name)
    const [labelOffsetX, labelOffsetY] = offsets(component.label)
    wardleyBuilderAddNode(db, {
      className: 'component',
      id: component.name,
      inertia: { value: component.inertia },
      label: component.name,
      labelOffsetX,
      labelOffsetY,
      sourceStrategy: { value: component.decorator },
      x,
      y,
    })
  }

  for (const note of ast.notes) {
    const [x, y] = toCoordinatesOf(note.visibility, note.evolution, 'Note ', note.text)
    wardleyBuilderAddNote(db, { text: note.text, x, y })
  }

  for (const pipeline of ast.pipelines) {
    const parent = wardleyBuilderGetNode(db, pipeline.parent)
    if (parent === undefined) {
      throw semantic(
        `${quoted('Pipeline ', pipeline.parent)} must reference an existing component with coordinates.`,
      )
    }
    const y = parent.y
    wardleyBuilderStartPipeline(db, pipeline.parent)
    for (const component of pipeline.components) {
      const id = `${pipeline.parent}_${component.name}`
      const [labelOffsetX, labelOffsetY] = offsets(component.label)
      const x = inRange(component.evolution)
        ? component.evolution <= 1
          ? component.evolution * 100
          : component.evolution
        : toPercent(component.evolution, join(quoted('Pipeline component ', component.name), ' evolution'))
      wardleyBuilderAddNode(db, {
        className: 'pipeline-component',
        id,
        inertia: { value: undefined },
        label: component.name,
        labelOffsetX,
        labelOffsetY,
        sourceStrategy: { value: undefined },
        x,
        y,
      })
      wardleyBuilderAddPipelineComponent(db, pipeline.parent, id)
    }
  }

  for (const link of ast.links) {
    const arrow = link.arrow
    const dashed = arrow !== undefined && (arrow.includes('-.->') || arrow.includes('.-.'))
    const [arrowFlow, arrowLabel] = flowFromArrow(arrow)
    const flow = flowFromPort(link.fromPort) ?? flowFromPort(link.toPort) ?? arrowFlow
    const source = wardleyBuilderResolveNodeId(db, link.from)
    const target = wardleyBuilderResolveNodeId(db, link.to)
    wardleyBuilderAddLink(db, {
      dashed,
      flow,
      label: arrowLabel ?? link.linkLabel,
      source,
      target,
    })
  }

  for (const evolve of ast.evolves) {
    const node = wardleyBuilderGetNode(db, evolve.component)
    if (node !== undefined) {
      const y = node.y
      const targetX = toPercent(evolve.target, quoted('Evolve target for ', evolve.component))
      wardleyBuilderAddTrend(db, { nodeId: evolve.component, targetX, targetY: y })
    }
  }

  const box = ast.annotations[0]
  if (box !== undefined) {
    const [x, y] = toCoordinates(box[0], box[1], 'Annotations box')
    wardleyBuilderSetAnnotationsBox(db, x, y)
  }

  for (const annotation of ast.annotation) {
    const context = buf('Annotation ')
    pushNumber(context, annotation.number)
    const [x, y] = toCoordinates(annotation.x, annotation.y, context.s)
    wardleyBuilderAddAnnotation(db, {
      coordinates: [[x, y]],
      number: annotation.number,
      text: annotation.text,
    })
  }

  for (const accelerator of ast.accelerators) {
    const [x, y] = toCoordinates(accelerator.x, accelerator.y, quoted('Accelerator ', accelerator.name))
    wardleyBuilderAddAccelerator(db, { name: accelerator.name, x, y })
  }

  for (const deaccelerator of ast.deaccelerators) {
    const [x, y] = toCoordinates(
      deaccelerator.x,
      deaccelerator.y,
      quoted('Deaccelerator ', deaccelerator.name),
    )
    wardleyBuilderAddDeaccelerator(db, { name: deaccelerator.name, x, y })
  }
}

/** `text.replace(/\n\s+/g, '\n')`. */
function collapseIndents(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    out += text[i]
    i += 1
    if (c === 0x0a) {
      while (i < text.length && isSpace(text.charCodeAt(i))) i += 1
    }
  }
  return out
}

/**
 * Builds the model from the syntax tree, as Pele's `buildWardley` does. `title` comes from front
 * matter and gives way to the map's own.
 *
 * @throws {CompileError} The semantic errors of {@link populate}.
 */
export function buildWardley(ast: WardleyAst, title: string | undefined): WardleyModel {
  const db = wardleyBuilderDefault()
  populate(ast, db)
  return {
    accDescr: ast.accDescr !== undefined && ast.accDescr !== '' ? collapseIndents(ast.accDescr) : undefined,
    accTitle: ast.accTitle !== undefined && ast.accTitle !== '' ? trimStart(ast.accTitle) : undefined,
    build: wardleyBuilderBuild(db),
    title: ast.title !== undefined && ast.title !== '' ? ast.title : title,
  }
}
