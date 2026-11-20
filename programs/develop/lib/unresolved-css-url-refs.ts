//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {Compilation, Compiler} from '@rspack/core'
import * as messages from './messages'

const STYLESHEET_FILE = /\.(?:css|pcss|postcss|scss|sass|less|styl|stylus)$/i
const STYLE_BLOCK_QUERY = /[?&]type=style(?:&|$)/

// A script reaches the same resolver through new URL(), so the file that
// asks decides the words. A request nobody owns reads as a stylesheet's.
export function isStylesheetIssuer(issuer: string): boolean {
  if (!issuer) return true

  const queryAt = issuer.indexOf('?')
  const file = queryAt === -1 ? issuer : issuer.slice(0, queryAt)

  return (
    STYLESHEET_FILE.test(file) ||
    (queryAt !== -1 && STYLE_BLOCK_QUERY.test(issuer.slice(queryAt)))
  )
}

// A url() the bundler cannot resolve stays verbatim in the stylesheet. It is
// the same dead reference the stylesheet check reports, under the same name.
export class UnresolvedCssUrlRefs {
  public static readonly name: string = 'report-unresolved-css-url-refs'
  private readonly refs = new Map<string, {request: string; issuer: string}>()

  record(request: string, issuer: string): void {
    this.refs.set(`${issuer}\u0000${request}`, {request, issuer})
  }

  apply(compiler: Compiler): void {
    compiler.hooks.afterCompile.tap(
      UnresolvedCssUrlRefs.name,
      (compilation: Compilation) => {
        if (this.refs.size === 0) return

        const strict = process.env.EXTENSION_STRICT_REFS === 'true'
        const context = String(compiler.options.context || '')
        const ErrorCtor = compiler.rspack?.WebpackError || Error

        for (const {request, issuer} of this.refs.values()) {
          const issuerPath = issuer
            ? path.relative(context, issuer).split(path.sep).join('/')
            : ''
          const fromSheet = isStylesheetIssuer(issuer)
          const report = new ErrorCtor(
            fromSheet
              ? messages.unresolvedCssUrlRef(issuerPath, request, strict)
              : messages.unresolvedScriptUrlRef(issuerPath, request, strict)
          )
          report.name = fromSheet ? 'CssDeadRef' : 'ScriptUrlFileMissing'
          ;(strict ? compilation.errors : compilation.warnings).push(report)
        }

        this.refs.clear()
      }
    )
  }
}
