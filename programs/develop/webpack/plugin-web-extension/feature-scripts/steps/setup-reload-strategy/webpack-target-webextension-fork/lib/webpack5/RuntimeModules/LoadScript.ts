import {TemplateFn} from '../helper'
import {RuntimeGlobal, RuntimeGlobalIsBrowser} from './BrowserRuntime'

// import()
const DYNAMIC_IMPORT_LOADER = 'dynamicImportLoader'
// createElement('script')
const DOM_LOADER = 'scriptLoader'
// importScripts
const WORKER_LOADER = 'workerLoader'
// browser.runtime.sendMessage() / MAIN world bridge
const CLASSIC_LOADER = 'classicLoader'
// MAIN world bridge loader (avoid redeclare)
const MAIN_CLASSIC_LOADER = 'classicLoaderMainWorld'
// fallback choice when DYNAMIC_IMPORT_LOADER fails
const FALLBACK_LOADER = 'fallbackLoader'

export default function LoadScriptRuntimeModule(
  webpack: typeof import('webpack'),
  supportDynamicImport: boolean | undefined,
  classicLoaderEnabled: boolean | undefined,
  contentScriptsMeta?: Record<
    string,
    {world?: 'main' | 'extension'; bridgeBundleId?: string}
  >
): import('webpack').RuntimeModule {
  const {Template, RuntimeGlobals, RuntimeModule} = webpack as any

  class LoadScriptRuntime extends RuntimeModule {
    private readonly supportDynamicImport: boolean
    private readonly classicLoaderEnabled: boolean
    private readonly contentScriptsMeta: Record<string, any>

    constructor() {
      // stage is for rspack to override the builtin implementation
      super('load script', RuntimeModule.STAGE_BASIC)
      this.supportDynamicImport = Boolean(supportDynamicImport)
      this.classicLoaderEnabled = Boolean(classicLoaderEnabled)
      this.contentScriptsMeta = contentScriptsMeta || {}
    }

    generate() {
      const {compilation} = this as any
      if (!compilation)
        return Template.asString(
          '/* [webpack-target-webextension] ChunkLoaderFallbackRuntimeModule skipped because no compilation is found. */'
        )
      const {f} = TemplateFn(compilation, Template)
      const _const = compilation.outputOptions.environment.const
        ? 'const'
        : 'var'
      const _let = compilation.outputOptions.environment.const ? 'let' : 'var'

      const chunkName =
        ((this as any).chunk && (this as any).chunk.name
          ? (this as any).chunk.name
          : '') ||
        (compilation &&
        (compilation as any).chunk &&
        (compilation as any).chunk.name
          ? (compilation as any).chunk.name
          : '')
      const bundleId = chunkName ? `${chunkName}.js` : ''
      const world =
        bundleId && this.contentScriptsMeta[bundleId]
          ? this.contentScriptsMeta[bundleId].world
          : undefined
      const isMainWorld = world === 'main'

      const HasExtensionRuntime =
        `${_const} hasExtensionRuntime = (function(){ try {` +
        'return (' +
        '(typeof browser === "object" && browser && browser.runtime && typeof browser.runtime.sendMessage === "function") || ' +
        '(typeof chrome === "object" && chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function")' +
        ');' +
        '} catch (e) { return false; } })();'

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
              'done();'
            ]),
            '}',
            'catch (_) {',
            Template.indent([
              'if (!bug816121warned) {',
              Template.indent([
                'console.warn("Chrome bug https://crbug.com/816121 hit.");',
                'bug816121warned = true;'
              ]),
              '}',
              `return ${FALLBACK_LOADER}(url, done, key, chunkId);`
            ]),
            '}'
          ])}, ${f('e', [
            'console.warn("Dynamic import loader failed. Using fallback loader (see https://github.com/awesome-webextension/webpack-target-webextension#content-script).", e);',
            `${FALLBACK_LOADER}(url, done, key, chunkId);`
          ])});`
        )

      const DOMLoader =
        `${_const} ${DOM_LOADER} = ` +
        f('url, done', [
          `${_const} script = document.createElement('script');`,
          'script.src = url;',
          'script.onload = done;',
          'script.onerror = done;',
          'document.body.appendChild(script);'
        ])

      const WorkerLoader =
        `${_const} ${WORKER_LOADER} = ` +
        f('url, done', [
          'try {',
          Template.indent(['importScripts(url);', 'done();']),
          '} catch (e) {',
          Template.indent(['done(e);']),
          '}'
        ])

      const ClassicLoader =
        `${_const} ${CLASSIC_LOADER} = ` +
        f(
          'url, done',
          Template.asString([
            `${_const} msg = { type: "WTW_INJECT", file: url };`,
            `${_const} onError = ${f('e', 'done(Object.assign(e, { type: "missing" }))')};`,
            `if (${RuntimeGlobalIsBrowser}) {`,
            Template.indent([
              `${RuntimeGlobal}.runtime.sendMessage(msg).then(done, onError);`
            ]),
            '} else {',
            Template.indent([
              `${RuntimeGlobal}.runtime.sendMessage(msg, ${f('', [
                `${_const} error = ${RuntimeGlobal}.runtime.lastError;`,
                'if (error) onError(error);',
                'else done();'
              ])});`
            ]),
            '}'
          ])
        ) +
        ';'

      const ClassicLoaderDisabled =
        `${_const} ${CLASSIC_LOADER} = ` +
        f('', [
          `throw new Error("[webpack-target-webextension] Failed to load async chunk in the content script. No script loader is found. You can either\\n - Set output.environment.dynamicImport to true if your environment supports native ES Module\\n - Specify the background entry to enable the fallback loader\\n - Set module.parser.javascript.dynamicImportMode to 'eager' to inline all async chunks.");`
        ])

      return Template.asString(
        [
          this.supportDynamicImport
            ? `${_let} bug816121warned, isNotIframe;`
            : '',
          this.supportDynamicImport
            ? Template.asString([
                'try {',
                Template.indent([
                  'isNotIframe = typeof window === "object" ? window.top === window : true;'
                ]),
                '} catch(e) {',
                Template.indent(['isNotIframe = false /* CORS error */;']),
                '}'
              ])
            : '',

          HasExtensionRuntime,
          this.classicLoaderEnabled ? ClassicLoader : ClassicLoaderDisabled,
          this.supportDynamicImport ? DynamicImportLoader : '',
          DOMLoader,
          WorkerLoader,

          `${_const} isWorker = typeof importScripts === 'function'`,
          // extension page / content script
          "if (typeof location === 'object' && location.protocol.includes('-extension:')) {",
          Template.indent([
            `${RuntimeGlobals.loadScript} = isWorker ? ${WORKER_LOADER} : ${DOM_LOADER};`
          ]),
          `} else {`,
          Template.indent(
            isMainWorld
              ? Template.asString([
                  `${_const} __extjsMark = "__extjs__";`,
                  `${_const} __extjsReqType = "EXTJS_WTW_LOAD";`,
                  `${_const} __extjsResType = "EXTJS_WTW_LOADED";`,
                  `${_const} ${MAIN_CLASSIC_LOADER} = ` +
                    f('url, done', [
                      `${_const} requestId = String(Date.now()) + "-" + Math.random().toString(16).slice(2);`,
                      `${_const} onMessage = ${f('event', [
                        'try {',
                        Template.indent([
                          'if (!event || event.source !== window) return;',
                          `${_const} data = event.data || null;`,
                          `if (!data || data[__extjsMark] !== true) return;`,
                          `if (data.type !== __extjsResType || data.requestId !== requestId) return;`,
                          'window.removeEventListener("message", onMessage);',
                          'if (data.ok) done();',
                          'else done(Object.assign(new Error(data.error || "Bridge failed"), { type: "missing" }));'
                        ]),
                        '} catch (e) {',
                        Template.indent([
                          'window.removeEventListener("message", onMessage);',
                          'done(Object.assign(e, { type: "missing" }));'
                        ]),
                        '}'
                      ])};`,
                      'window.addEventListener("message", onMessage);',
                      'try {',
                      Template.indent([
                        'window.postMessage({ [__extjsMark]: true, type: __extjsReqType, requestId: requestId, url: url }, "*");'
                      ]),
                      '} catch (e) {',
                      Template.indent([
                        'window.removeEventListener("message", onMessage);',
                        'done(Object.assign(e, { type: "missing" }));'
                      ]),
                      '}',
                      'setTimeout(function(){ try { window.removeEventListener("message", onMessage); } catch(_){} done(Object.assign(new Error("Bridge timeout"), { type: "missing" })); }, 5000);'
                    ]) +
                    ';',
                  `if (!isWorker) ${RuntimeGlobals.loadScript} = ${MAIN_CLASSIC_LOADER};`
                ])
              : Template.asString([
                  `if (!isWorker && hasExtensionRuntime) ${RuntimeGlobals.loadScript} = ${CLASSIC_LOADER};`,
                  `else if (!isWorker) ${RuntimeGlobals.loadScript} = ${DOM_LOADER};`
                ])
          ),
          `}`,

          this.supportDynamicImport
            ? `${_const} ${FALLBACK_LOADER} = ${RuntimeGlobals.loadScript};`
            : '',
          this.supportDynamicImport
            ? `${RuntimeGlobals.loadScript} = ${DYNAMIC_IMPORT_LOADER};`
            : ''
        ].filter(Boolean)
      )
    }
  }

  return new LoadScriptRuntime() as unknown as import('webpack').RuntimeModule
}
