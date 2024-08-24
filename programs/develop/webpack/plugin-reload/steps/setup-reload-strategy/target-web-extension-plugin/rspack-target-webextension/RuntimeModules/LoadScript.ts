import {rspack, Compilation, sources} from '@rspack/core'
import BrowserRuntime from '../BrowserRuntime'

// import()
const DYNAMIC_IMPORT_LOADER = 'dynamicImportLoader'
const DOM_LOADER = 'scriptLoader'
const WORKER_LOADER = 'workerLoader'
const CLASSIC_LOADER = 'classicLoader'
const CLASSIC_SUPPORT = '__send__'
const FALLBACK_LOADER = 'fallbackLoader'

export function LoadScriptRuntimeModule(
  rspackLib: typeof rspack,
  supportDynamicImport: boolean | undefined,
  classicLoaderEnabled: boolean | undefined,
  acceptWeak: boolean
) {
  const {Template, RuntimeGlobals} = rspackLib

  const dynamicImportLoader = Template.asString([
    `var ${DYNAMIC_IMPORT_LOADER} = function(url, done, key, chunkId) {`,
    Template.indent([
      `import(url).then(function() {`,
      Template.indent([
        `if (isNotIframe) return done();`,
        `try {`,
        Template.indent([
          `chunkId !== undefined && ${RuntimeGlobals.ensureChunkHandlers}.j(chunkId);`,
          `done();`
        ]),
        `} catch (err) {`,
        Template.indent([
          `if (!bug816121warned) {`,
          Template.indent([
            'console.warn("Chrome bug https://crbug.com/816121 hit.");',
            'bug816121warned = true;'
          ]),
          `}`,
          `${FALLBACK_LOADER}(url, done, key, chunkId);`
        ]),
        `}`
      ]),
      `}, function(e) {`,
      Template.indent([
        `console.warn('Dynamic import loader failed. Using fallback loader.', e);`,
        `${FALLBACK_LOADER}(url, done, key, chunkId);`
      ]),
      `});`
    ]),
    `};`
  ])

  const domLoader = Template.asString([
    `var ${DOM_LOADER} = function(url, done) {`,
    Template.indent([
      `var script = document.createElement('script');`,
      `script.src = url;`,
      `script.onload = done;`,
      `script.onerror = done;`,
      `document.body.appendChild(script);`
    ]),
    `};`
  ])

  const workerLoader = Template.asString([
    `var ${WORKER_LOADER} = function(url, done) {`,
    Template.indent([
      `try { importScripts(url); done(); } catch (e) { done(e); }`
    ]),
    `};`
  ])

  const classicLoaderSupport = Template.asString([
    `var ${CLASSIC_SUPPORT} = function(msg) {`,
    Template.indent([
      `if (isBrowser) return runtime.runtime.sendMessage(msg);`,
      `return new Promise(function(r) { runtime.runtime.sendMessage(msg, r); });`
    ]),
    `};`
  ])

  const classicLoader = Template.asString([
    `var ${CLASSIC_LOADER} = function(url, done) {`,
    Template.indent([
      `${CLASSIC_SUPPORT}({ type: 'WTW_INJECT', file: url }).then(done, function(e) { done(Object.assign(e, { type: 'missing' })); });`
    ]),
    `};`
  ])

  const classicLoaderDisabled = Template.asString([
    `var ${CLASSIC_LOADER} = function() {`,
    Template.indent([
      'throw new Error("No loader for content script is found. Enable ES Module loader or specify the background entry in your config.");'
    ]),
    `};`
  ])

  const fallbackLoader = Template.asString([
    `var ${FALLBACK_LOADER} = ${RuntimeGlobals.loadScript};`
  ])

  const scriptSetup = Template.asString([
    supportDynamicImport ? `var bug816121warned, isNotIframe;` : '',
    supportDynamicImport
      ? `try { isNotIframe = typeof window === "object" ? window.top === window : true; } catch(e) { isNotIframe = false; }`
      : '',
    classicLoaderEnabled ? classicLoaderSupport : '',
    classicLoaderEnabled ? classicLoader : classicLoaderDisabled,
    supportDynamicImport ? dynamicImportLoader : '',
    domLoader,
    workerLoader,
    `var isWorker = typeof importScripts === 'function';`,
    `if (typeof location === 'object' && location.protocol.includes('-extension:')) {`,
    Template.indent([
      `${RuntimeGlobals.loadScript} = isWorker ? ${WORKER_LOADER} : ${DOM_LOADER};`
    ]),
    `} else if (!isWorker) {`,
    Template.indent([`${RuntimeGlobals.loadScript} = ${CLASSIC_LOADER};`]),
    `} else {`,
    Template.indent([
      `throw new TypeError('Unable to determine the chunk loader: content script + Worker');`
    ]),
    `}`,
    supportDynamicImport ? fallbackLoader : '',
    supportDynamicImport
      ? `${RuntimeGlobals.loadScript} = ${DYNAMIC_IMPORT_LOADER};`
      : ''
  ])

  return new sources.RawSource(scriptSetup)
}
