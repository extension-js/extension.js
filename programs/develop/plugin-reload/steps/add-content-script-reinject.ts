// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {extendContentScriptWrapper} from '../../plugin-web-extension/shared/content-script-wrapper-extensions'
import {contentScriptReinject} from '../reload-lib/content-script-reinject'

// The wrapper's own reading of a dev session: the option when the config
// names one, otherwise any mode but production.
export function wrapsForDevSession(
  mode: string | undefined,
  devSession: boolean | undefined
): boolean {
  return typeof devSession === 'boolean'
    ? devSession
    : String(mode || '').toLowerCase() !== 'production'
}

// Lets a content script bundle replace the copy an earlier injection left in
// the page: a registry of generations, owner markers and root sweeps.
export class AddContentScriptReinject {
  constructor(private readonly devSession: boolean | undefined) {}

  apply(compiler: Compiler): void {
    if (!wrapsForDevSession(compiler.options.mode, this.devSession)) return

    extendContentScriptWrapper(compiler, contentScriptReinject)
  }
}
