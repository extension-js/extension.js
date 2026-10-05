// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {type Compiler, WebpackError} from '@rspack/core'
import * as messages from './static-assets-lib/messages'

const ASSET_MODULE_TYPES = new Set([
  'asset',
  'asset/bytes',
  'asset/inline',
  'asset/resource',
  'asset/source'
])

interface SourcePosition {
  line: number
  column: number
}

interface SpecifierLocation {
  start?: SourcePosition
  end?: SourcePosition
}

interface ReadableModule {
  resource?: string
  originalSource?: () => {source: () => string | Buffer} | null
}

function sourceLineOf(
  module: ReadableModule,
  line: number
): string | undefined {
  try {
    const source = module.originalSource?.()?.source()
    if (source === undefined || source === null) return undefined

    return String(source).split('\n')[line - 1]
  } catch {
    return undefined
  }
}

// The specifier carries no export name for `text?.default` and `typeof text`
// either, and neither one hands the object on as the value.
function readsTheObjectItself(
  module: ReadableModule,
  loc: SpecifierLocation
): string | undefined {
  if (!loc.start || !loc.end || loc.start.line !== loc.end.line) {
    return undefined
  }

  const line = sourceLineOf(module, loc.start.line)
  if (line === undefined) return undefined

  const name = line.slice(loc.start.column - 1, loc.end.column - 1)
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return undefined

  const before = line.slice(0, loc.start.column - 1)
  const after = line.slice(loc.end.column - 1)

  if (/^\s*\?\./.test(after)) return undefined
  if (/\btypeof\s*\(?\s*$/.test(before)) return undefined

  return name
}

// `import * as text from './notes.txt'` is a module object, and the file's
// value sits on its default key. Read whole, it reaches the browser as
// "[object Module]" from a build that had nothing to say.
export class CheckNamespaceImports {
  apply(compiler: Compiler) {
    const name = CheckNamespaceImports.name

    compiler.hooks.compilation.tap(name, (compilation) => {
      compilation.hooks.finishModules.tap(name, (modules) => {
        for (const module of modules) {
          if (!ASSET_MODULE_TYPES.has(module.type)) continue

          const reported = new Set<string>()

          for (const connection of compilation.moduleGraph.getIncomingConnections(
            module
          )) {
            const {dependency, originModule} = connection
            if (!originModule) continue
            if (dependency.type !== 'esm import specifier') continue
            if (!dependency.ids || dependency.ids.length > 0) continue

            const origin = originModule as unknown as ReadableModule
            const resource = String(origin.resource || '')
            if (!resource || /[\\/]node_modules[\\/]/.test(resource)) continue

            const {loc} = dependency
            if (!loc) continue

            const binding = readsTheObjectItself(
              origin,
              loc as SpecifierLocation
            )
            if (!binding) continue

            const request = String(dependency.request || '')
            const key = `${resource}\n${binding}\n${request}`
            if (reported.has(key)) continue

            reported.add(key)

            const error = new WebpackError(
              messages.namespaceImportReadAsValue(binding, request)
            ) as Error & {
              module?: typeof originModule
              loc?: typeof loc
              file?: string
            }
            error.name = 'NamespaceImportReadAsValue'

            // A child compilation's modules are unknown to the stats that
            // print its errors, so there the file names the place.
            if (compilation.compiler.isChild()) {
              error.file = path.relative(
                compiler.context,
                resource.split('?')[0]
              )
            } else {
              error.module = originModule
            }

            error.loc = loc
            // The message is the whole story, a stack would only point in here.
            error.stack = ''
            compilation.errors.push(error)
          }
        }
      })
    })
  }
}
