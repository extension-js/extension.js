// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {isCanonicalContentScriptAsset} from '../contracts'

/**
 * Parse-check every emitted content-script bundle and FAIL the compile on a
 * SyntaxError. swc tolerates some early errors (e.g. a top-level `let x` +
 * `const {x}` redeclaration) and happily emits them into the bundle, and the
 * browser then silently skips the unparsable file: no console error, no
 * injection, dev's "Reloading content_script…" reloading nothing. Real-world
 * hit: Origin-pod__OriginBrain shipped exactly that shape and looked healthy
 * everywhere while its content script never ran.
 *
 * `new Function(source)` only COMPILES the source (nothing executes), so this
 * is a cheap, safe V8 parse, the same engine family that will load the file.
 * Content scripts are always injected as classic scripts, so function-body
 * parsing is the right (slightly lenient) approximation.
 */
export class ValidateContentScriptSyntax {
  apply(compiler: Compiler): void {
    if (!compiler?.hooks?.thisCompilation?.tap) return
    compiler.hooks.thisCompilation.tap(
      'scripts:validate-content-script-syntax',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:validate-content-script-syntax',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const assets =
              typeof compilation.getAssets === 'function'
                ? compilation.getAssets()
                : []
            for (const asset of assets) {
              const name = asset?.name || ''
              if (!isCanonicalContentScriptAsset(name)) continue
              if (!name.endsWith('.js')) continue

              let source = ''
              try {
                source = asset.source?.source?.().toString() || ''
              } catch {
                continue
              }
              if (!source) continue

              try {
                // eslint-disable-next-line no-new-func
                new Function(source)
              } catch (error: any) {
                if (error?.name !== 'SyntaxError') continue
                const err = new WebpackError(
                  [
                    `${name} is not valid JavaScript: ${error.message}.`,
                    'The browser will silently skip an unparsable content script:',
                    'it never injects and reports no error anywhere. Fix the syntax',
                    'error in the source file(s) this content_scripts entry bundles.'
                  ].join('\n')
                ) as Error & {file?: string}
                err.file = name
                compilation.errors.push(err)
              }
            }
          }
        )
      }
    )
  }
}
