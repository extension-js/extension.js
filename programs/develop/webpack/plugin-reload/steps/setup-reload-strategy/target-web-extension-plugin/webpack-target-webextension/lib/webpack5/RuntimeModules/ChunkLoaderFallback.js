// @ts-check

const { TemplateFn } = require('../helper.js')
const BrowserRuntime = require('./BrowserRuntime.js')

/**
 * @param {import('webpack')} webpack
 */
module.exports = function ChunkLoaderFallbackRuntimeModule(webpack) {
  const { RuntimeModule, Template } = webpack
  class ChunkLoaderFallbackRuntimeModule extends RuntimeModule {
    constructor() {
      super('chunk loader fallback', RuntimeModule.STAGE_TRIGGER)
    }
    generate() {
      const { compilation } = this
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] ChunkLoaderFallbackRuntimeModule skipped because no compilation is found. */',
        )
      const { f } = TemplateFn(compilation, Template)
      const optionalChain = compilation.outputOptions.environment.optionalChaining
      const _const = compilation.outputOptions.environment.const ? 'const' : 'var'
      const _let = compilation.outputOptions.environment.const ? 'let' : 'var'

      return (
        `${BrowserRuntime.RuntimeGlobal}.runtime.onMessage.addListener(` +
        f('message, sender, sendResponse', [
          optionalChain
            ? 'if (message?.type != "WTW_INJECT" || typeof sender?.tab?.id != "number") return;'
            : 'if (!message || message.type != "WTW_INJECT" || !sender || !sender.tab || sender.tab.id == null) return;',
          `${_let} file = message.file;`,
          'try {',
          Template.indent(['file = new URL(file).pathname;']),
          '} catch (_) {}',
          'if (!file) return;',
          `if (${BrowserRuntime.RuntimeGlobal}.scripting) {`,
          Template.indent([
            `${BrowserRuntime.RuntimeGlobal}.scripting.executeScript({`,
            Template.indent(['target: { tabId: sender.tab.id, frameIds: [sender.frameId] },', 'files: [file],']),
            '}).then(sendResponse);',
          ]),
          `} else {`,
          Template.indent([
            `${_const} details = { frameId: sender.frameId, file, matchAboutBlank: true };`,
            `if (${BrowserRuntime.RuntimeGlobalIsBrowser}) {`,
            `${BrowserRuntime.RuntimeGlobal}.tabs.executeScript(sender.tab.id, details).then(sendResponse);`,
            '} else {',
            `${BrowserRuntime.RuntimeGlobal}.tabs.executeScript(sender.tab.id, details, sendResponse);`,
            '}',
          ]),
          '}',
          'return true;',
        ]) +
        ');'
      )
    }
  }
  return new ChunkLoaderFallbackRuntimeModule()
}
