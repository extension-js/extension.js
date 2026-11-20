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
          const report = new ErrorCtor(
            messages.unresolvedCssUrlRef(issuerPath, request, strict)
          )
          report.name = 'CssDeadRef'
          ;(strict ? compilation.errors : compilation.warnings).push(report)
        }

        this.refs.clear()
      }
    )
  }
}
