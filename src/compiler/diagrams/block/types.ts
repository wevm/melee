/** @module The block diagram model. Port of Pele's `src/diagrams/block/types.ts`. */

/**
 * One shape for blocks, edges, and the statements that set columns, classes, and styles, as in
 * Mermaid. Blocks live in the model's arena and name their children by index.
 */
export type Block = {
  /** The marker at the end of an edge. */
  arrowTypeEnd: string | undefined
  /** The marker at the start of an edge. */
  arrowTypeStart: string | undefined
  /** Child blocks, by arena index. */
  children: number[] | undefined
  /** Class names applied with `class`. */
  classes: string[] | undefined
  /** The order of a composite among composites. */
  colorIndex: number | undefined
  /** Grid width: a count, or -1 to put every child on one row. */
  columns: number | undefined
  /** The declarations of a `classDef` statement. */
  css: string | undefined
  /** The directions of a block arrow, or those of the block an edge ends at. */
  directions: string[] | undefined
  /** The id an edge ends at. */
  end: string | undefined
  /** The id. A column setting has none, and neither has a composite whose header was a link. */
  id: string | undefined
  /** The label. */
  label: string | undefined
  /** `dotted` or `solid`, for an edge. */
  pattern: string | undefined
  /** The id an edge starts at. */
  start: string | undefined
  /** The class name of a `class` statement. */
  styleClass: string | undefined
  /** Declarations applied with `style`. */
  styles: string[] | undefined
  /** The declarations of a `style` statement. */
  stylesStr: string | undefined
  /** `thick` or `normal`, for an edge. */
  thickness: string | undefined
  /** The kind of block or statement, such as `square`, `composite`, `edge`, or `classDef`. */
  type: string
  /** The number of cells a `space` statement asked for. */
  width: number | undefined
  /** The number of columns the block spans. */
  widthInColumns: number | undefined
}

/** `Block::default()`. */
export function blockDefault(): Block {
  return {
    arrowTypeEnd: undefined,
    arrowTypeStart: undefined,
    children: undefined,
    classes: undefined,
    colorIndex: undefined,
    columns: undefined,
    css: undefined,
    directions: undefined,
    end: undefined,
    id: undefined,
    label: undefined,
    pattern: undefined,
    start: undefined,
    styleClass: undefined,
    styles: undefined,
    stylesStr: undefined,
    thickness: undefined,
    type: '',
    width: undefined,
    widthInColumns: undefined,
  }
}

/** A deep copy of `block`, as `Block::clone` makes. */
export function blockClone(block: Block): Block {
  return {
    arrowTypeEnd: block.arrowTypeEnd,
    arrowTypeStart: block.arrowTypeStart,
    children: block.children?.slice(),
    classes: block.classes?.slice(),
    colorIndex: block.colorIndex,
    columns: block.columns,
    css: block.css,
    directions: block.directions?.slice(),
    end: block.end,
    id: block.id,
    label: block.label,
    pattern: block.pattern,
    start: block.start,
    styleClass: block.styleClass,
    styles: block.styles?.slice(),
    stylesStr: block.stylesStr,
    thickness: block.thickness,
    type: block.type,
    width: block.width,
    widthInColumns: block.widthInColumns,
  }
}

/** A `classDef`: declarations for shapes and for text. */
export type BlockClassDef = {
  /** The class name. */
  id: string
  /** Declarations for shapes. */
  styles: string[]
  /** Declarations for text. */
  textStyles: string[]
}

/** `BlockClassDef::default()`. */
export function blockClassDefDefault(): BlockClassDef {
  return { id: '', styles: [], textStyles: [] }
}
