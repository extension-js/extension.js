// ██╗      ██████╗  █████╗ ██████╗ ███████╗██████╗
// ██║     ██╔═══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ██║     ██║   ██║███████║██║  ██║█████╗  ██████╔╝
// ██║     ██║   ██║██╔══██║██║  ██║██╔══╝  ██╔══██╗
// ███████╗╚██████╔╝██║  ██║██████╔╝███████╗██║  ██║
// ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler, RuntimeModule} from '@rspack/core'
import {RuntimeGlobal, RuntimeGlobalIsBrowser} from './browser-runtime'
import {TemplateFn} from './template-fn'

// Derived from webpack-target-webextension (MIT, Copyright 2020 CRIMX).
// The license notice is in the README of this folder.

// The background side of the message fallback: it injects the chunk a
// content script asked for into the tab and frame that asked.
export function ChunkLoaderFallbackRuntimeModule(
  webpack: Compiler['webpack']
): RuntimeModule {
  const {RuntimeModule, Template} = webpack

  class ChunkLoaderFallbackRuntime extends RuntimeModule {
    constructor() {
      super('chunk loader fallback', RuntimeModule.STAGE_TRIGGER)
    }

    generate(): string {
      const {compilation} = this

      if (!compilation) {
        return Template.asString(
          '/* [webpack-target-webextension] ChunkLoaderFallbackRuntimeModule skipped because no compilation is found. */'
        )
      }

      const {f} = TemplateFn(compilation)
      const optionalChain =
        compilation.outputOptions.environment?.optionalChaining
      const _const = compilation.outputOptions.environment?.const
        ? 'const'
        : 'var'
      const _let = compilation.outputOptions.environment?.const ? 'let' : 'var'

      // The runtime global can be unset or hold no runtime when this runs,
      // and registering on it then would crash the service worker.
      return (
        `if (${RuntimeGlobal} && ${RuntimeGlobal}.runtime && ${RuntimeGlobal}.runtime.onMessage) {` +
        `${RuntimeGlobal}.runtime.onMessage.addListener(` +
        f('message, sender, sendResponse', [
          optionalChain
            ? 'if (message?.type != "WTW_INJECT" || typeof sender?.tab?.id != "number") return;'
            : 'if (!message || message.type != "WTW_INJECT" || !sender || !sender.tab || sender.tab.id == null) return;',
          `${_let} file = message.file;`,
          'try {',
          Template.indent(['file = new URL(file).pathname;']),
          '} catch (_) {}',
          'if (!file) return;',
          `if (${RuntimeGlobal}.scripting) {`,
          Template.indent([
            `${RuntimeGlobal}.scripting.executeScript({`,
            Template.indent([
              'target: { tabId: sender.tab.id, frameIds: [sender.frameId] },',
              'files: [file],'
            ]),
            '}).then(sendResponse);'
          ]),
          `} else {`,
          Template.indent([
            `${_const} details = { frameId: sender.frameId, file, matchAboutBlank: true };`,
            `if (${RuntimeGlobalIsBrowser}) {`,
            `${RuntimeGlobal}.tabs.executeScript(sender.tab.id, details).then(sendResponse);`,
            '} else {',
            `${RuntimeGlobal}.tabs.executeScript(sender.tab.id, details, sendResponse);`,
            '}'
          ]),
          '}',
          'return true;'
        ]) +
        ');' +
        '}'
      )
    }
  }

  return new ChunkLoaderFallbackRuntime()
}
