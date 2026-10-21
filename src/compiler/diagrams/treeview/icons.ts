/** @module Which icon each tree view entry shows. Port of Pele's `src/diagrams/treeview/icons.ts`. */
import { type Value, valueTruthy } from '../../yaml.ts'
import { NodeType, type TreeNode } from './model.ts'

/**
 * Mermaid's name for its built-in pack. Only `file` and `folder` are built in; every other icon
 * name is offered to the host's icon resolver.
 */
export const BUILTIN_PACK = 'mermaid-treeview'

/** The built-in outline named `name`, on a 24 by 24 grid. */
export function glyph(name: string): string | undefined {
  switch (name) {
    case 'file':
      return 'M6.5 3h7L19 8.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM13.5 3v5.5H19'
    case 'folder':
      return 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2.4 2.5h8A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z'
    default:
      return undefined
  }
}

/** The icon options of the `treeView` config section: Pele's `IconConfig`. */
export type IconConfig = {
  /** The pack of an icon name written without one. */
  defaultIconPack: string
  /** Icons by file extension. */
  extensionIcons: [string, Value][] | undefined
  /** Icons by file name. */
  filenameIcons: [string, Value][] | undefined
  /** Whether entries without an `icon()` show one. */
  showIcons: boolean
}

/** The entries of `value` when it is a mapping. */
function map(value: Value | undefined): [string, Value][] | undefined {
  return value !== undefined && value.kind === 'Object' ? value._0 : undefined
}

/** The string at `key` of `map`, as an own property. */
function own(entries: [string, Value][] | undefined, key: string): string | undefined {
  if (entries === undefined) return undefined
  const found = entries.find(([name]) => name === key)
  return found !== undefined && found[1].kind === 'String' ? found[1]._0 : undefined
}

/** `char::to_lowercase` of each character of `text`. */
function lowercase(text: string): string {
  let out = ''
  for (const c of text) out += c.toLowerCase()
  return out
}

/**
 * A file's icon from the configured maps. A file name wins over an extension, and extensions
 * match in lower case with or without the leading dot.
 */
export function detectIcon(name: string, config: IconConfig): string | undefined {
  const byName = own(config.filenameIcons, name)
  if (byName !== undefined && byName !== '') return byName
  const dot = name.lastIndexOf('.')
  if (!(dot > 0)) return undefined
  const ext = lowercase(name.slice(dot))
  return own(config.extensionIcons, ext) ?? own(config.extensionIcons, ext.slice(1))
}

/** The icon name with its pack. */
function qualifyIcon(icon: string, defaultIconPack: string): string {
  if (icon.includes(':')) return icon
  const pack = glyph(icon) !== undefined || defaultIconPack === '' ? BUILTIN_PACK : defaultIconPack
  return `${pack}:${icon}`
}

/**
 * The qualified icon name for a node, or `undefined` when it shows none. An `icon()` annotation
 * always wins; otherwise icons appear only with `showIcons`.
 */
export function getNodeIcon(node: TreeNode, config: IconConfig): string | undefined {
  const icon = node.icon
  if (icon === 'none') return undefined
  if (icon !== undefined && icon !== '') return qualifyIcon(icon, config.defaultIconPack)
  if (!config.showIcons) return undefined
  if (node.nodeType === NodeType.File) {
    const detected = detectIcon(node.name, config)
    if (detected === 'none') return undefined
    if (detected !== undefined && detected !== '') return qualifyIcon(detected, config.defaultIconPack)
  }
  return BUILTIN_PACK + (node.nodeType === NodeType.Directory ? ':folder' : ':file')
}

/** The icon options of `config`, as Pele's `iconConfig` reads them. */
export function iconConfig(config: Value): IconConfig {
  const section = config.kind === 'Object' ? map(config._0.find(([key]) => key === 'treeView')?.[1]) : undefined
  const get = (key: string): Value | undefined => section?.find(([name]) => name === key)?.[1]
  const pack = get('defaultIconPack')
  const show = get('showIcons')
  return {
    defaultIconPack: pack !== undefined && pack.kind === 'String' ? pack._0 : '',
    extensionIcons: map(get('extensionIcons')),
    filenameIcons: map(get('filenameIcons')),
    showIcons: show !== undefined && valueTruthy(show),
  }
}
