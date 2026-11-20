// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {createRequire} from 'node:module'
import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import * as messages from '../messages'

const requireModule = createRequire(import.meta.url)

// Parse-check every emitted script and FAIL the compile on a SyntaxError: swc
// emits some early errors and the browser silently skips them. Scoped to
// content scripts once, which is how an action page and a service worker could
// both ship a file the engine refuses to parse under a green exit code.
export class ValidateEmittedScriptSyntax {
  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'scripts:validate-emitted-script-syntax',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:validate-emitted-script-syntax',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const assets =
              typeof compilation.getAssets === 'function'
                ? compilation.getAssets()
                : []

            for (const asset of assets) {
              const name = asset?.name || ''
              if (!/\.[cm]?js$/i.test(name)) continue

              let source = ''

              try {
                source = asset.source?.source?.().toString() || ''
              } catch {
                continue
              }

              if (!source) continue

              const error = findSyntaxError(source)
              if (!error) continue

              const err = new WebpackError(
                messages.emittedScriptUnparsable(name, error.message)
              ) as Error & {file?: string}
              err.file = name
              err.name = 'ContentScriptSyntax'
              compilation.errors.push(err)
            }
          }
        )
      }
    )
  }
}

// Script mode first, since that is how every classic bundle is evaluated. An
// ES module output is legal too and would fail that check on `import`, top-level
// `await` or `import.meta`, so a module parse gets the last word.
function findSyntaxError(source: string): Error | undefined {
  try {
    // eslint-disable-next-line no-new-func
    new Function(source)

    return undefined
  } catch (caught) {
    const error = caught as Error | undefined
    if (error?.name !== 'SyntaxError') return undefined
    if (parsesAsModule(source)) return undefined

    return error
  }
}

function parsesAsModule(source: string): boolean {
  try {
    const acorn = requireModule('acorn')
    acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowHashBang: true
    })

    return true
  } catch {
    return false
  }
}
