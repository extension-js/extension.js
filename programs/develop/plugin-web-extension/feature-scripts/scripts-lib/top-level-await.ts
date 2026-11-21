// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as messages from '../messages'
import {parseProgram} from './default-export'

interface AstNode {
  type: string
  start: number
  [key: string]: unknown
}

interface TopLevelAwait {
  line: number
  column: number
}

// Each of these opens a scope of its own, where `await` belongs to a
// function or is a syntax error the parser already reports.
const OWN_SCOPE =
  /Function|Method|^ClassProperty$|^ClassPrivateProperty$|^PropertyDefinition$|^ClassAccessorProperty$|^StaticBlock$/

const isModuleSyntax = (node: AstNode) =>
  (node.type === 'ImportDeclaration' && node.importKind !== 'type') ||
  node.type === 'ExportDefaultDeclaration' ||
  ((node.type === 'ExportNamedDeclaration' ||
    node.type === 'ExportAllDeclaration') &&
    node.exportKind !== 'type')

function firstAwaitIn(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce(
      (first: number, child) => Math.min(first, firstAwaitIn(child)),
      Infinity
    )
  }

  if (!node || typeof (node as AstNode).type !== 'string') return Infinity

  const {type, start} = node as AstNode

  if (OWN_SCOPE.test(type)) return Infinity

  if (
    type === 'AwaitExpression' ||
    (type === 'ForOfStatement' && (node as AstNode).await === true) ||
    (type === 'VariableDeclaration' && (node as AstNode).kind === 'await using')
  ) {
    return start
  }

  let first = Infinity

  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc' || key === 'leadingComments') continue

    if (child && typeof child === 'object') {
      first = Math.min(first, firstAwaitIn(child))
    }
  }

  return first
}

// The first `await` outside every function of a file with no import or
// export: the bundler compiles that file as a classic script, which has none.
export function findTopLevelAwait(
  source: string,
  resourcePath: string
): TopLevelAwait | undefined {
  if (!/\bawait\b/.test(source)) return undefined

  const program = parseProgram(source, resourcePath)

  if ('error' in program) return undefined

  if (program.body.some((node) => isModuleSyntax(node as AstNode))) {
    return undefined
  }

  const at = firstAwaitIn(program.body)

  if (!Number.isFinite(at)) return undefined

  const before = source.slice(0, at)
  const lineStart = before.lastIndexOf('\n') + 1

  return {
    line: before.split('\n').length,
    column: at - lineStart + 1
  }
}

// The text a loader hands on can sit at other lines than the file as
// written, so the place is read from the file when it has the same await.
export function refuseTopLevelAwait(
  source: string,
  resourcePath: string,
  label: string,
  // Declared in the manifest, or a scripts/ file a scripting call injects.
  declared: boolean,
  readAuthored: () => string | undefined = () => undefined
): void {
  const found = findTopLevelAwait(source, resourcePath)

  if (!found) return

  const authored = readAuthored()
  const written =
    authored !== undefined && authored !== source
      ? findTopLevelAwait(authored, resourcePath)
      : undefined
  const {line, column} = written || found

  const message = messages.contentScriptTopLevelAwait(
    label,
    line,
    column,
    declared
  )

  // The bundler prints the stack, and the frames of the build say nothing
  // about the script, so the stack is the heading alone.
  throw Object.assign(new Error(message), {
    name: 'ContentScriptSyntax',
    stack: `ContentScriptSyntax: ${message}`
  })
}
