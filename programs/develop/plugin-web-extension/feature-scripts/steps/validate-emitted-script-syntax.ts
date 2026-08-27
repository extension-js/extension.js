// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {createRequire} from 'node:module'
import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {isCanonicalContentScriptAsset} from '../contracts'

const requireModule = createRequire(import.meta.url)

// Parse-check every emitted script and FAIL the compile on a SyntaxError: swc
// emits some early errors and the browser silently skips them. Scoped to
// content scripts once, which is how an action page and a service worker could
// both ship a file the engine refuses to parse under a green exit code.
export class ValidateEmittedScriptSyntax {
  apply(compiler: Compiler): void {
    if (!compiler?.hooks?.thisCompilation?.tap) return
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
                [
                  `${name} is not valid JavaScript: ${error.message}.`,
                  ...describeSlot(name)
                ].join('\n')
              ) as Error & {file?: string}
              err.file = name
              compilation.errors.push(err)
            }
          }
        )
      }
    )
  }
}

function describeSlot(name: string): string[] {
  if (isCanonicalContentScriptAsset(name)) {
    return [
      'The browser will silently skip an unparsable content script:',
      'it never injects and reports no error anywhere. Fix the syntax',
      'error in the source file(s) this content_scripts entry bundles.'
    ]
  }

  return [
    'The browser refuses to run a file it cannot parse, so the surface this',
    'backs is dead on arrival. Fix the syntax error in the source file(s)',
    'this entry bundles.'
  ]
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
