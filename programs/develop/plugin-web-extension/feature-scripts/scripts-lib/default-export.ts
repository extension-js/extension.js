// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import {parse as parseModuleSyntax} from 'es-module-lexer'
import * as messages from '../messages'

const requireModule = createRequire(import.meta.url)

export const MOUNT_NAME = '__EXTENSIONJS_default__'

interface AstNode {
  type: string
  start: number
  end: number
  [key: string]: unknown
}

interface Edit {
  start: number
  end: number
  text: string
}

type DefaultExportReading =
  // No default export, so the file runs as it is written.
  | {kind: 'none'}
  // No parser reads the file, so the build reports its own syntax error.
  | {kind: 'broken'}
  | {
      kind: 'found'
      // The source with each default export statement turned into a binding.
      code: string
      // What the wrapper appends so MOUNT_NAME names the default export.
      binding: string
      // A default exported through a list stays the module's own export.
      keepsOwnExport: boolean
      // The module-scope name of the default export, unless it is a class.
      localName?: string
      // Top-level calls of that name left out, since the wrapper mounts it.
      removedCalls: number
      // Calls of that name anywhere else, each one a run beside the mount.
      keptCalls: number
    }

const isTyped = (extension: string) => /^\.[cm]?tsx?$/.test(extension)
const hasNoJsx = (extension: string) => /^\.[cm]?ts$/.test(extension)

// The wrapper runs before the transpiler, so it reads TypeScript and JSX as
// written or as a loader returned them: acorn first, then Babel's parser.
export function parseProgram(
  source: string,
  resourcePath: string
): {body: AstNode[]} | {error: string} {
  const extension = path.extname(resourcePath).toLowerCase()

  if (!isTyped(extension) && !/^\.m?jsx$/.test(extension)) {
    const base = {ecmaVersion: 'latest', allowHashBang: true}

    for (const options of [
      {...base, sourceType: 'module'},
      {...base, sourceType: 'script', allowAwaitOutsideFunction: true}
    ]) {
      try {
        return {body: requireModule('acorn').parse(source, options).body}
      } catch {
        // The next reading, then the one that knows JSX.
      }
    }
  }

  try {
    const plugins = [
      ...(isTyped(extension) ? ['typescript'] : []),
      ...(hasNoJsx(extension) ? [] : ['jsx']),
      'decorators',
      'decoratorAutoAccessors',
      'explicitResourceManagement',
      'deferredImportEvaluation',
      'sourcePhaseImports',
      ['importAttributes', {deprecatedAssertSyntax: true}]
    ]

    return {
      body: requireModule('@babel/core').parseSync(source, {
        babelrc: false,
        configFile: false,
        sourceType: 'unambiguous',
        parserOpts: {plugins, errorRecovery: true}
      }).program.body
    }
  } catch (error) {
    return {error: String((error as Error)?.message || error).split('\n')[0]}
  }
}

// A file the bundler would reject keeps its own error. One it accepts with
// a default export this reader missed must not ship as a script that never runs.
function unparsed(
  source: string,
  resourcePath: string,
  label: string,
  reason: string,
  loaders: string[]
): DefaultExportReading {
  const extension = path.extname(resourcePath).toLowerCase()

  try {
    const {experiments} = requireModule('@rspack/core')
    const {code} = experiments.swc.transformSync(source, {
      filename: resourcePath,
      jsc: {
        parser: isTyped(extension)
          ? {syntax: 'typescript', tsx: !hasNoJsx(extension), decorators: true}
          : {syntax: 'ecmascript', jsx: true, decorators: true},
        target: 'esnext'
      },
      isModule: 'unknown'
    })
    const [, exported] = parseModuleSyntax(code)

    if (
      !exported.some((entry) => 'name' in entry && entry.name === 'default')
    ) {
      return {kind: 'none'}
    }
  } catch {
    return {kind: 'broken'}
  }

  // The text is what those loaders returned, so the advice is about them.
  throw Object.assign(
    new Error(
      loaders.length > 0
        ? messages.defaultExportLostToLoaders(label, loaders, reason)
        : messages.defaultExportUnreadable(label, reason)
    ),
    {name: 'ContentScriptSyntax'}
  )
}

// Reads `export`, then whitespace and comments, then `default`, in one pass.
// A scan, not a pattern: a pattern here backtracks on a long run of comments.
function exportDefaultKeywords(text: string): string | undefined {
  if (!text.startsWith('export')) return undefined

  let at = 'export'.length

  while (at < text.length) {
    if (/\s/.test(text[at])) {
      at += 1
    } else if (text.startsWith('/*', at)) {
      const close = text.indexOf('*/', at + 2)
      if (close === -1) return undefined

      at = close + 2
    } else if (text.startsWith('//', at)) {
      const lineEnd = text.indexOf('\n', at)
      at = lineEnd === -1 ? text.length : lineEnd + 1
    } else {
      break
    }
  }

  return text.startsWith('default', at)
    ? text.slice(0, at + 'default'.length)
    : undefined
}

const DECLARATION =
  /^(?:FunctionDeclaration|ClassDeclaration|TSDeclareFunction)$/

function nameOf(node: unknown): string | undefined {
  const named = node as {type?: string; name?: unknown; value?: unknown} | null

  if (named?.type === 'Identifier') return String(named.name)

  // acorn and Babel name a quoted export differently.
  if (named?.type === 'Literal' || named?.type === 'StringLiteral') {
    return String(named.value)
  }

  return undefined
}

const isCallOf = (node: unknown, name: string) => {
  const call = node as {type?: string; callee?: unknown; arguments?: unknown[]}

  return (
    call?.type === 'CallExpression' &&
    nameOf(call.callee) === name &&
    (call.callee as AstNode).type === 'Identifier' &&
    call.arguments?.length === 0
  )
}

// Calls of the function from outside it: a call it makes to itself, as a
// retry does, belongs to the run that is already under way.
function countCallsOf(node: unknown, name: string): number {
  if (Array.isArray(node)) {
    return node.reduce((sum, child) => sum + countCallsOf(child, name), 0)
  }

  if (!node || typeof (node as AstNode).type !== 'string') return 0

  const {type, id} = node as AstNode

  if (
    (type === 'FunctionDeclaration' || type === 'VariableDeclarator') &&
    nameOf(id) === name
  ) {
    return 0
  }

  return Object.values(node).reduce(
    (sum: number, child) => sum + countCallsOf(child, name),
    isCallOf(node, name) ? 1 : 0
  )
}

// Every edit keeps the line count, so the line map of the source still holds.
const lineBreaksOf = (text: string) => text.replace(/[^\n]/g, '')

export function readDefaultExport(
  source: string,
  resourcePath: string,
  label: string = resourcePath,
  parse: typeof parseProgram = parseProgram,
  // The loaders of extension.config.js that ran before this reading.
  loaders: string[] = []
): DefaultExportReading {
  if (!/\bdefault\b/.test(source)) return {kind: 'none'}

  const program = parse(source, resourcePath)

  if ('error' in program) {
    return unparsed(source, resourcePath, label, program.error, loaders)
  }

  const edits: Edit[] = []
  let binding = ''
  let keepsOwnExport = false
  let localName: string | undefined
  let found = false
  const textOf = (node: AstNode) => source.slice(node.start, node.end)

  for (const node of program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      const declaration = node.declaration as AstNode
      const keywords = exportDefaultKeywords(textOf(node))

      // A default-exported interface is a type, with nothing to mount.
      if (!keywords || declaration.type === 'TSInterfaceDeclaration') continue

      found = true
      const keywordsEnd = node.start + keywords.length
      const lineBreaks = lineBreaksOf(keywords)
      const declared = DECLARATION.test(declaration.type)
        ? nameOf(declaration.id)
        : undefined

      // A named declaration stays one, so its name is bound and hoisted.
      if (declared) {
        edits.push({start: node.start, end: keywordsEnd, text: lineBreaks})
        binding = `const ${MOUNT_NAME} = ${declared};\n`
        if (declaration.type !== 'ClassDeclaration') localName = declared

        continue
      }

      edits.push({
        start: node.start,
        end: keywordsEnd,
        text: `const ${MOUNT_NAME} =${lineBreaks}`
      })

      // A declaration ends itself, an initializer runs on into a next line
      // that opens with a bracket.
      if (source[node.end - 1] !== ';') {
        edits.push({start: node.end, end: node.end, text: ';'})
      }

      if (declaration.type === 'Identifier') localName = nameOf(declaration)

      continue
    }

    const from = node.source as AstNode | null | undefined

    if (node.type === 'ExportAllDeclaration') {
      if (!from || nameOf(node.exported) !== 'default') continue

      found = true
      keepsOwnExport = true
      binding = `import * as ${MOUNT_NAME} from ${textOf(from)};\n`

      continue
    }

    if (node.type !== 'ExportNamedDeclaration' || node.exportKind === 'type') {
      continue
    }

    for (const specifier of (node.specifiers as AstNode[] | undefined) || []) {
      if (
        specifier.exportKind === 'type' ||
        nameOf(specifier.exported) !== 'default'
      ) {
        continue
      }

      found = true
      keepsOwnExport = true

      if (!from) {
        localName = nameOf(specifier.local)
        binding = `const ${MOUNT_NAME} = ${localName};\n`
      } else if (specifier.type === 'ExportNamespaceSpecifier') {
        binding = `import * as ${MOUNT_NAME} from ${textOf(from)};\n`
      } else if (nameOf(specifier.local) === 'default') {
        binding = `import ${MOUNT_NAME} from ${textOf(from)};\n`
      } else {
        binding = `import {${textOf(specifier.local as AstNode)} as ${MOUNT_NAME}} from ${textOf(from)};\n`
      }
    }
  }

  if (!found) return {kind: 'none'}

  let removedCalls = 0

  // Only a statement of the module body: a call in a function, a callback,
  // a block or a condition runs when the author's own code decides.
  for (const node of localName ? program.body : []) {
    if (
      node.type === 'ExpressionStatement' &&
      isCallOf(node.expression, localName as string)
    ) {
      removedCalls++
      edits.push({
        start: node.start,
        end: node.end,
        text: `;${lineBreaksOf(textOf(node))}`
      })
    }
  }

  const keptCalls = localName
    ? countCallsOf(program.body, localName) - removedCalls
    : 0
  let code = source

  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end)
  }

  return {
    kind: 'found',
    code,
    binding,
    keepsOwnExport,
    localName,
    removedCalls,
    keptCalls
  }
}

// A loader that drops the default export the author wrote leaves a script
// that builds and never mounts, so the build stops and names the loader.
export function refuseDefaultExportLostToLoaders(
  authored: string,
  resourcePath: string,
  label: string,
  loaders: string[]
): void {
  let wasWritten = true

  try {
    wasWritten =
      readDefaultExport(authored, resourcePath, label).kind === 'found'
  } catch {
    // Only a file with a default export is refused as unreadable.
  }

  if (!wasWritten) return

  throw Object.assign(
    new Error(messages.defaultExportLostToLoaders(label, loaders)),
    {name: 'ContentScriptSyntax'}
  )
}
