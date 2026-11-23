//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation, Compiler} from '@rspack/core'
import {sayPendingAfterCompile} from '../lib/pending-diagnostics'
import * as messages from './compilation-lib/messages'
import {nodeBuiltinName} from './node-builtins'

// A bare require() that resolves to no module stays verbatim in the bundle,
// the way Chrome loads the script. The externals resolver records each one.
export class UnresolvedBareRequires {
  public static readonly name: string = 'warn-unresolved-bare-requires'
  private readonly issuers = new Map<string, string>()

  record(request: string, issuer: string): void {
    if (!this.issuers.has(request)) this.issuers.set(request, issuer)
  }

  apply(compiler: Compiler): void {
    sayPendingAfterCompile(
      compiler,
      UnresolvedBareRequires.name,
      (compilation: Compilation) => {
        if (this.issuers.size === 0) return

        const ErrorCtor = compiler.rspack?.WebpackError || Error

        for (const [request, issuer] of this.issuers) {
          const warning = new ErrorCtor(
            messages.unresolvedBareRequire(
              request,
              issuer,
              nodeBuiltinName(request)
            )
          )
          warning.name = 'UnresolvedBareRequireWarning'
          compilation.warnings.push(warning)
        }

        this.issuers.clear()
      }
    )
  }
}
