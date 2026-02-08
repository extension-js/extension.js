import {TemplateFn} from '../helper'
import {RuntimeGlobal, RuntimeGlobalIsBrowser} from './BrowserRuntime'

export default function ChunkLoaderFallbackRuntimeModule(
  webpack: typeof import('webpack')
): import('webpack').RuntimeModule {
  const {RuntimeModule, Template} = webpack as any
  class ChunkLoaderFallbackRuntime extends RuntimeModule {
    constructor() {
      super('chunk loader fallback', RuntimeModule.STAGE_TRIGGER)
    }
    generate() {
      const {compilation} = this as any
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] ChunkLoaderFallbackRuntimeModule skipped because no compilation is found. */'
        )
      const {f} = TemplateFn(compilation, Template)
      const optionalChain =
        compilation.outputOptions.environment.optionalChaining
      const _const = compilation.outputOptions.environment.const
        ? 'const'
        : 'var'
      const _let = compilation.outputOptions.environment.const ? 'let' : 'var'

      return (
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
        ');'
      )
    }
  }
  return new ChunkLoaderFallbackRuntime() as unknown as import('webpack').RuntimeModule
}
