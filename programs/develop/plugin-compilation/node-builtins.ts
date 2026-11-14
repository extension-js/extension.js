//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {builtinModules} from 'node:module'
import type {Compilation, Compiler} from '@rspack/core'
import * as messages from './compilation-lib/messages'

// Names Node itself only answers with the prefix (`node:test`) are left out:
// their bare spelling belongs to whatever npm package carries that name.
const BARE_BUILTINS = new Set(
  builtinModules.filter((name) => !name.startsWith('node:'))
)

const NODE_SCHEME = 'node:'

// The built-in a request names, in its bare spelling, or undefined when the
// request is anything else. `node:fs/promises` and `fs/promises` both answer.
export function nodeBuiltinName(request: string): string | undefined {
  const bare = request.startsWith(NODE_SCHEME)
    ? request.slice(NODE_SCHEME.length)
    : request

  if (BARE_BUILTINS.has(bare)) return bare

  return BARE_BUILTINS.has(bare.split('/')[0]) ? bare : undefined
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const CANNOT_RESOLVE = /Module not found: Can't resolve '([^']+)'/
const UNHANDLED_SCHEME = /Reading from "(node:[^"]+)" is not handled by plugins/

type BuildError = Error & {
  module?: {resource?: string}
  loc?: unknown
  file?: string
}

// `node:fs` and `fs` are one module to Node, so the prefix comes off before
// the resolver runs and both spellings reach the same stub or polyfill.
export class NodeBuiltinsPlugin {
  apply(compiler: Compiler) {
    const name = NodeBuiltinsPlugin.name
    const prefixOnlyIssuers = new Map<string, string>()

    compiler.hooks.normalModuleFactory.tap(name, (factory) => {
      factory.hooks.beforeResolve.tap(name, (data) => {
        const request = String(data?.request || '')
        if (!request.startsWith(NODE_SCHEME)) return

        const bare = nodeBuiltinName(request)

        if (bare) data.request = bare
        else prefixOnlyIssuers.set(request, data.contextInfo?.issuer || '')
      })
    })

    compiler.hooks.afterCompile.tap(name, (compilation: Compilation) => {
      const ErrorCtor = compiler.rspack?.WebpackError || Error
      const errors = compilation.errors as unknown as BuildError[]
      const fallback = compiler.options.resolve?.fallback || {}
      const stubbed = Object.entries(fallback)
        .filter(([, target]) => target === false)
        .map(([request]) => request)

      for (let index = 0; index < errors.length; index++) {
        const error = errors[index]
        const text = String(error?.message || '').replace(ANSI, '')
        const unresolved = CANNOT_RESOLVE.exec(text)?.[1]
        const unhandled = UNHANDLED_SCHEME.exec(text)?.[1]
        const builtin = unresolved ? nodeBuiltinName(unresolved) : unhandled
        if (!builtin) continue

        const issuer = unhandled
          ? prefixOnlyIssuers.get(unhandled) || ''
          : String(error.module?.resource || '')
        const next = new ErrorCtor(
          messages.nodeBuiltinHasNoStandIn(
            builtin,
            issuer,
            stubbed,
            unhandled ? '' : String(error.message || '')
          )
        ) as BuildError

        next.name = 'NodeBuiltinNotAvailable'
        if (error.module && !unhandled) next.module = error.module
        if (error.loc && !unhandled) next.loc = error.loc
        if (error.file) next.file = error.file

        errors.splice(index, 1, next)
      }

      prefixOnlyIssuers.clear()
    })
  }
}
