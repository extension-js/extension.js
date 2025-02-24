// @ts-check
const { TemplateFn } = require('../helper.js')
const BrowserRuntime = require('./BrowserRuntime.js')

// import()
const DYNAMIC_IMPORT_LOADER = 'dynamicImportLoader'
// createElement('script')
const DOM_LOADER = 'scriptLoader'
// importScripts
const WORKER_LOADER = 'workerLoader'
// browser.runtime.sendMessage()
const CLASSIC_LOADER = 'classicLoader'
// fallback choice when DYNAMIC_IMPORT_LOADER fails
const FALLBACK_LOADER = 'fallbackLoader'

/**
 * @param {import('webpack')} webpack
 * @param {boolean | undefined} supportDynamicImport
 * @param {boolean | undefined} classicLoaderEnabled
 * @returns {import('webpack').RuntimeModule}
 */
module.exports = function LoadScriptRuntimeModule(webpack, supportDynamicImport, classicLoaderEnabled) {
  const { Template, RuntimeGlobals, RuntimeModule } = webpack
  class LoadScriptRuntimeModule extends RuntimeModule {
    constructor() {
      // stage is for rspack to override the builtin implementation
      super('load script', RuntimeModule.STAGE_BASIC)
      this.supportDynamicImport = Boolean(supportDynamicImport)
      this.classicLoaderEnabled = Boolean(classicLoaderEnabled)
    }
    /**
     * @returns {string} runtime code
     */
    generate() {
      const { compilation } = this
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] ChunkLoaderFallbackRuntimeModule skipped because no compilation is found. */',
        )
      const { f } = TemplateFn(compilation, Template)
      const _const = compilation.outputOptions.environment.const ? 'const' : 'var'
      const _let = compilation.outputOptions.environment.const ? 'let' : 'var'
      const DynamicImportLoader =
        `${_const} ${DYNAMIC_IMPORT_LOADER} = ` +
        f(
          'url, done, key, chunkId',
          `import(url).then(${f('', [
            'if (isNotIframe) return done();',
            'try {',
            Template.indent([
              "// It's a Chrome bug, if the import() is called in a sandboxed iframe, it _fails_ the script loading but _resolve_ the Promise.",
              `// we call ${RuntimeGlobals.ensureChunkHandlers}.j(chunkId) to check if it is loaded.`,
              '// if it is, this is a no-op. if it is not, it will throw a TypeError because this function requires 2 parameters.',
              '// This call will not trigger the chunk loading because it is already loading.',
              '// see https://github.com/awesome-webextension/webpack-target-webextension/issues/41',
              `chunkId !== undefined && ${RuntimeGlobals.ensureChunkHandlers}.j(chunkId);`,
              'done();',
            ]),
            '}',
            'catch (_) {',
            Template.indent([
              'if (!bug816121warned) {',
              Template.indent(['console.warn("Chrome bug https://crbug.com/816121 hit.");', 'bug816121warned = true;']),
              '}',
              `return ${FALLBACK_LOADER}(url, done, key, chunkId);`,
            ]),
            '}',
          ])}, ${f('e', [
            'console.warn("Dynamic import loader failed. Using fallback loader (see https://github.com/awesome-webextension/webpack-target-webextension#content-script).", e);',
            `${FALLBACK_LOADER}(url, done, key, chunkId);`,
          ])});`,
        )
      const DOMLoader =
        `${_const} ${DOM_LOADER} = ` +
        f('url, done', [
          `${_const} script = document.createElement('script');`,
          'script.src = url;',
          'script.onload = done;',
          'script.onerror = done;',
          'document.body.appendChild(script);',
        ])
      const WorkerLoader =
        `${_const} ${WORKER_LOADER} = ` +
        f('url, done', [
          'try {',
          Template.indent(['importScripts(url);', 'done();']),
          '} catch (e) {',
          Template.indent(['done(e);']),
          '}',
        ])
      const ClassicLoader =
        `${_const} ${CLASSIC_LOADER} = ` +
        f(
          'url, done',
          Template.asString([
            `${_const} msg = { type: "WTW_INJECT", file: url };`,
            `${_const} onError = ${f('e', 'done(Object.assign(e, { type: "missing" }))')};`,
            `if (${BrowserRuntime.RuntimeGlobalIsBrowser}) {`,
            Template.indent([`${BrowserRuntime.RuntimeGlobal}.runtime.sendMessage(msg).then(done, onError);`]),
            '} else {',
            Template.indent([
              `${BrowserRuntime.RuntimeGlobal}.runtime.sendMessage(msg, ${f('', [
                `${_const} error = ${BrowserRuntime.RuntimeGlobal}.runtime.lastError;`,
                'if (error) onError(error);',
                'else done();',
              ])});`,
            ]),
            '}',
          ]),
        ) +
        ';'
      const ClassicLoaderDisabled =
        `${_const} ${CLASSIC_LOADER} = ` +
        f('', [
          `throw new Error("[webpack-target-webextension] Failed to load async chunk in the content script. No script loader is found. You can either\\n - Set output.environment.dynamicImport to true if your environment supports native ES Module\\n - Specify the background entry to enable the fallback loader\\n - Set module.parser.javascript.dynamicImportMode to 'eager' to inline all async chunks.");`,
        ])
      return Template.asString(
        [
          this.supportDynamicImport ? `${_let} bug816121warned, isNotIframe;` : '',
          this.supportDynamicImport
            ? Template.asString([
                'try {',
                Template.indent(['isNotIframe = typeof window === "object" ? window.top === window : true;']),
                '} catch(e) {',
                Template.indent(['isNotIframe = false /* CORS error */;']),
                '}',
              ])
            : '',

          this.classicLoaderEnabled ? ClassicLoader : ClassicLoaderDisabled,
          this.supportDynamicImport ? DynamicImportLoader : '',
          DOMLoader,
          WorkerLoader,

          `${_const} isWorker = typeof importScripts === 'function'`,
          // extension page
          "if (typeof location === 'object' && location.protocol.includes('-extension:')) {",
          Template.indent([`${RuntimeGlobals.loadScript} = isWorker ? ${WORKER_LOADER} : ${DOM_LOADER};`]),
          `}`,
          // content script
          `else if (!isWorker) ${RuntimeGlobals.loadScript} = ${CLASSIC_LOADER};`,
          // worker in content script
          "else { throw new TypeError('Unable to determinate the chunk loader: content script + Worker'); }",

          this.supportDynamicImport ? `${_const} ${FALLBACK_LOADER} = ${RuntimeGlobals.loadScript};` : '',
          this.supportDynamicImport ? `${RuntimeGlobals.loadScript} = ${DYNAMIC_IMPORT_LOADER};` : '',
        ].filter(Boolean),
      )
    }
  }
  return new LoadScriptRuntimeModule()
}
