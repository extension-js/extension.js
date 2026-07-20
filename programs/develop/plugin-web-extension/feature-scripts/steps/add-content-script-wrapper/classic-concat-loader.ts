// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

// Classic content-script concatenation loader.
//
// When a content script entry consists of multiple plain JS files (no
// import/export), the browser injects them in order into one world so they
// share a single global scope. ES-module sequencing (`import "a"; import "b"`)
// would isolate each file and break those implicit cross-file globals.
//
// This loader concatenates the sources at build time (matching browser
// semantics), registers each original file via `addDependency` so rspack's
// watcher triggers a rebuild on save, and emits a V3 source map so errors
// trace back to the real file and line.

import * as fs from 'node:fs'
import {createRequire} from 'node:module'

const requireModule = createRequire(import.meta.url)

// Raw TS in a concat group is a JS parse error, so strip types with rspack's
// bundled swc; isModule:false keeps classic non-strict (no directive prologue).
function transpileClassicTs(file: string, content: string): string {
  const {experiments} = requireModule('@rspack/core')
  return experiments.swc.transformSync(content, {
    filename: file,
    jsc: {parser: {syntax: 'typescript'}, target: 'esnext'},
    isModule: false,
    sourceMaps: false
  }).code
}

// Names that must never be bridged onto the global: the four UMD-shadowing
// wrapper params (bridging would undo them) plus the global aliases themselves.
const EXPOSE_SKIP = new Set([
  'module',
  'exports',
  'define',
  'require',
  'globalThis',
  'window',
  'self',
  'this'
])

// Scopes whose bodies never leak a binding to the page global. Blocks are
// deliberately NOT here (`var` hoists out); declarations are handled in visit().
const OPAQUE_SCOPES = new Set([
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassExpression'
])

const NON_CHILD_KEYS = new Set(['type', 'start', 'end', 'loc', 'range'])

export function collectClassicGlobalNames(
  _file: string,
  content: string
): string[] {
  // acorn parses JavaScript only, which is all this ever sees: TS members are
  // transpiled before they reach here. Loaded lazily to match the transpile path.
  const acorn = requireModule('acorn')
  const ast = acorn.parse(content, {
    ecmaVersion: 'latest',
    // Classic scripts, never modules: the concat gate guarantees no top-level
    // import/export, and script mode keeps sloppy-mode sources parseable.
    sourceType: 'script',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowHashBang: true
  })
  const names: string[] = []

  // Acorn AST nodes traversed dynamically; every field is runtime-checked, so
  // the walker sees a loose recursive shape instead of acorn's node union.
  interface LooseAstNode {
    type?: unknown
    kind?: unknown
    name?: unknown
    id?: LooseAstNode | null
    left?: LooseAstNode
    value?: LooseAstNode
    argument?: LooseAstNode
    properties?: Array<LooseAstNode | null>
    elements?: Array<LooseAstNode | null>
    declarations?: LooseAstNode[]
    [key: string]: unknown
  }

  const addBindingNames = (node: LooseAstNode | null | undefined): void => {
    if (!node || typeof node.type !== 'string') return
    switch (node.type) {
      case 'Identifier':
        names.push(String(node.name))
        return
      case 'ObjectPattern':
        for (const prop of node.properties || []) {
          if (!prop) continue
          // RestElement has `argument`; Property has `value` (the binding
          // target, since `key` is the source property name, not a binding).
          addBindingNames(
            prop.type === 'RestElement' ? prop.argument : prop.value
          )
        }
        return
      case 'ArrayPattern':
        for (const element of node.elements || []) addBindingNames(element)
        return
      case 'AssignmentPattern':
        // `var {a = 1} = o` / `var [b = 2] = arr`. The default is on the right.
        addBindingNames(node.left)
        return
      case 'RestElement':
        addBindingNames(node.argument)
        return
      default:
        return
    }
  }

  const visit = (
    node: LooseAstNode | null | undefined,
    topLevel: boolean
  ): void => {
    if (!node || typeof node.type !== 'string') return

    if (node.type === 'VariableDeclaration') {
      // let/const are lexical: only top-level ones are visible to later
      // scripts; a nested var hoists to the global like Chrome does.
      if (topLevel || node.kind === 'var') {
        for (const declarator of node.declarations || []) {
          addBindingNames(declarator.id)
        }
      }
      return
    }

    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'ClassDeclaration'
    ) {
      if (topLevel && node.id) names.push(String(node.id.name))
      // Never descend into function/class bodies, their vars stay local.
      return
    }

    if (OPAQUE_SCOPES.has(node.type)) return

    for (const key of Object.keys(node)) {
      if (NON_CHILD_KEYS.has(key)) continue
      const child = node[key]
      if (Array.isArray(child)) {
        for (const item of child) visit(item as LooseAstNode, false)
      } else {
        visit(child as LooseAstNode, false)
      }
    }
  }

  for (const statement of ast.body) {
    visit(statement, true)
  }

  return names
}

interface ClassicConcatLoaderContext {
  resourcePath: string
  resourceQuery: string
  addDependency(dep: string): void
  callback(err: Error | null, content?: string, sourceMap?: unknown): void
}

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const CONCAT_UMD_WRAP_OPEN = ';(function (module, exports, define, require) {'
const CONCAT_UMD_WRAP_CLOSE =
  '}).call(typeof globalThis !== "undefined" ? globalThis : this, void 0, void 0, void 0, void 0);'

function vlqEncode(value: number): string {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1
  let encoded = ''
  do {
    let digit = vlq & 0x1f
    vlq >>>= 5
    if (vlq > 0) digit |= 0x20
    encoded += BASE64[digit]
  } while (vlq > 0)
  return encoded
}

export default function classicConcatLoader(
  this: ClassicConcatLoaderContext,
  _source: string
): void {
  const query = this.resourceQuery || ''
  const match = query.match(/[?&]__extensionjs_classic_concat__=([^&]+)/)
  if (!match) {
    this.callback(null, _source)
    return
  }

  let data: {feature?: string; js?: string[]; css?: string[]}
  try {
    data = JSON.parse(decodeURIComponent(match[1]))
  } catch {
    this.callback(null, _source)
    return
  }

  const jsFiles: string[] = data.js || []
  const cssFiles: string[] = data.css || []
  const feature: string = data.feature || ''

  for (const file of jsFiles) {
    this.addDependency(file)
  }

  const outputLines: string[] = []
  const lineMappings: Array<{sourceIndex: number; sourceLine: number} | null> =
    []
  const sources: string[] = []
  const sourcesContent: string[] = []

  for (const css of cssFiles) {
    outputLines.push(`import ${JSON.stringify(String(css))};`)
    lineMappings.push(null)
  }

  // Param-shadowing require/module/exports/define stops rspack from statically
  // collecting UMD require() calls and makes UMD guards take the browser branch.
  outputLines.push(CONCAT_UMD_WRAP_OPEN)
  lineMappings.push(null)

  if (feature) {
    outputLines.push(
      `/* extension.js classic content-script concatenation: ${feature} */`
    )
    lineMappings.push(null)
  }

  const globalNames: string[] = []
  for (let fileIdx = 0; fileIdx < jsFiles.length; fileIdx++) {
    const file = jsFiles[fileIdx]
    const raw = fs.readFileSync(file, 'utf8')
    // Line mappings for transpiled TS are approximate (tsc's emitter mostly
    // preserves line positions, but removed type-only blocks shift them).
    const content = /\.ts$/i.test(file) ? transpileClassicTs(file, raw) : raw
    try {
      globalNames.push(...collectClassicGlobalNames(file, content))
    } catch {
      // A file the parser chokes on still concatenates; it just gets no
      // global bridge.
    }
    sources.push(file)
    sourcesContent.push(raw)

    outputLines.push(`/* ${file} */`)
    lineMappings.push(null)

    const fileLines = content.split('\n')
    for (let lineNo = 0; lineNo < fileLines.length; lineNo++) {
      outputLines.push(fileLines[lineNo])
      lineMappings.push({sourceIndex: fileIdx, sourceLine: lineNo})
    }

    // Semicolon guard between files to prevent ASI issues
    if (fileIdx < jsFiles.length - 1) {
      outputLines.push(';')
      lineMappings.push(null)
    }
  }

  // Classic-script top-level declarations belong on the page global; the
  // wrapper made them function-scoped, so bridge each name onto globalThis.
  const exposedNames = [...new Set(globalNames)].filter(
    (name) => !EXPOSE_SKIP.has(name) && /^[A-Za-z_$][\w$]*$/.test(name)
  )
  if (exposedNames.length > 0) {
    outputLines.push(
      '/* extension.js: classic top-level declarations land on the global (browser parity) */'
    )
    lineMappings.push(null)
    for (const name of exposedNames) {
      outputLines.push(
        `try { globalThis[${JSON.stringify(name)}] = ${name}; } catch (_e) {
          // Ignore
        }`
      )
      lineMappings.push(null)
    }
  }

  outputLines.push(CONCAT_UMD_WRAP_CLOSE)
  lineMappings.push(null)

  const output = outputLines.join('\n')

  // Generate V3 source map mappings. Each segment encodes: genColumn (always
  // 0), sourceIndex delta, sourceLine delta, sourceColumn delta (always 0).
  let prevSrcIdx = 0
  let prevSrcLine = 0
  const mappingSegments: string[] = []

  for (const mapping of lineMappings) {
    if (mapping === null) {
      mappingSegments.push('')
    } else {
      mappingSegments.push(
        vlqEncode(0) +
          vlqEncode(mapping.sourceIndex - prevSrcIdx) +
          vlqEncode(mapping.sourceLine - prevSrcLine) +
          vlqEncode(0)
      )
      prevSrcIdx = mapping.sourceIndex
      prevSrcLine = mapping.sourceLine
    }
  }

  const sourceMap = {
    version: 3 as const,
    sources,
    sourcesContent,
    mappings: mappingSegments.join(';'),
    names: [] as string[]
  }

  this.callback(null, output, sourceMap)
}
