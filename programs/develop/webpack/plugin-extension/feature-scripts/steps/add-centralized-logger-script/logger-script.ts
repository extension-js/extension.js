// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import fs from 'fs'
import path from 'path'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {filterKeysForThisBrowser} from '../../scripts-lib/manifest'
import {type LoaderContext} from '../../../../webpack-types'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    mode: {
      type: 'string'
    },
    browser: {
      type: 'string'
    }
  }
}

export default function (this: LoaderContext, source: string) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)
  const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const browser = options.browser || 'chrome'
  const manifest = filterKeysForThisBrowser(rawManifest as any, browser)

  validate(schema, options, {
    name: 'scripts:add-centralized-logger-script-content',
    baseDataPath: 'options'
  })

  const resourceAbsPath = path.normalize(this.resourcePath)

  // Emit a page-context script file to avoid inline injection under page CSP
  const pageScriptName = 'content-logger.page.js'
  const pageScriptContent = [
    '(function(){',
    '  function post(msg){ try { window.postMessage(msg, "*") } catch (_) {} }',
    '  window.addEventListener("error", function(e){',
    '    post({ __reactLogger: true, type: "log", level: "error",',
    '      messageParts: [ String(e && e.message || ""), String(e && e.filename || ""), e && e.lineno, e && e.colno ],',
    '      url: String(location && location.href || "") })',
    '  })',
    '  window.addEventListener("unhandledrejection", function(e){',
    '    var reason; try { reason = typeof e.reason === "string" ? e.reason : JSON.stringify(e.reason) } catch (_) { reason = String(e.reason) }',
    '    post({ __reactLogger: true, type: "log", level: "error", messageParts: ["Unhandled Rejection", reason], url: String(location && location.href || "") })',
    '  })',
    '  ["log","info","warn","error","debug","trace"].forEach(function(level){',
    '    try {',
    '      var original = console[level] && console[level].bind ? console[level].bind(console) : console[level]',
    '      console[level] = function(){ var args = [].slice.call(arguments); post({ __reactLogger: true, type: "log", level: level, messageParts: args, url: String(location && location.href || "") }); try { return original && original.apply ? original.apply(console, args) : void 0 } catch (_) {} }',
    '    } catch (_) {}',
    '  })',
    '  try {',
    '    var oc = console.clear && console.clear.bind ? console.clear.bind(console) : console.clear; if (oc) console.clear = function(){ try { post({ __reactLogger: true, type: "log", level: "info", messageParts: ["console.clear"], url: String(location && location.href || ""), meta: { kind: "clear" } }) } catch (_) {} try { return oc.apply(console, arguments) } catch (_) {} }',
    '  } catch (_) {}',
    '  ;["group","groupCollapsed","groupEnd"].forEach(function(k){ try { var og = console[k] && console[k].bind ? console[k].bind(console) : console[k]; if (!og) return; console[k] = function(){ var args = [].slice.call(arguments); try { post({ __reactLogger: true, type: "log", level: "log", messageParts: args, url: String(location && location.href || ""), meta: { kind: k } }) } catch (_) {} try { return og.apply(console, args) } catch (_) {} } } catch (_) {} })',
    '  ;["time","timeLog","timeEnd","count","countReset","table"].forEach(function(k){ try { var oo = console[k] && console[k].bind ? console[k].bind(console) : console[k]; if (!oo) return; console[k] = function(){ var args = [].slice.call(arguments); try { post({ __reactLogger: true, type: "log", level: "log", messageParts: args, url: String(location && location.href || ""), meta: { kind: k } }) } catch (_) {} try { return oo.apply(console, args) } catch (_) {} } } catch (_) {} })',
    '})()'
  ].join('\n')

  this.emitFile(pageScriptName, pageScriptContent)

  // Build UI logger bridge for content context
  const loggerBootstrap = `
/* centralized content logger bootstrap */
(function() {
  var contextLabel = 'content'
  var port
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connect) {
    var targetId = (function(){
      if (typeof window !== 'undefined' && (window).__EXT_LOGGER_ID__) return String((window).__EXT_LOGGER_ID__)
      try { var u = new URL(typeof location !== 'undefined' ? String(location.href) : ''); var v = u.searchParams.get('loggerId'); if (v) return v } catch {}
      return ''
    })()

    if (targetId) { try { port = chrome.runtime.connect(targetId, { name: 'logger' }) } catch (_) {} }
    if (!port) { try { port = chrome.runtime.connect({ name: 'logger' }) } catch (_) {} }

    if (!port && chrome.management && typeof chrome.management.getAll === 'function') {
      chrome.management.getAll(function(list){
        var found = (list||[]).find(function(it){ return it && typeof it.name === 'string' && it.name.toLowerCase().includes('centralized-logger') })
        if (found && found.id) { try { port = chrome.runtime.connect(found.id, { name: 'logger' }) } catch (_) {} }
      })
    }
  }

  function safePost(msg) { if (port && port.postMessage) { port.postMessage(msg) } }

  window.addEventListener('message', function(event){
    try {
      var data = (event && event.data) || {}
      if (!data || data.__reactLogger !== true || data.type !== 'log') return
      var parts = Array.isArray(data.messageParts) ? data.messageParts : [data.messageParts]
      var meta = (typeof data.meta === 'object' && data.meta) ? data.meta : undefined
      safePost({ type: 'log', level: String(data.level || 'log'), context: 'page', messageParts: parts, url: data.url, meta: meta })
    } catch (_) {}
  })

  var el = document.createElement('script')
  try { el.src = chrome.runtime.getURL('${pageScriptName}') } catch (_) {}
  (document.documentElement || document.head || document.body).appendChild(el)

  ;['log','info','warn','error','debug','trace'].forEach(function(level) {
    if (typeof console !== 'undefined' && typeof console[level] === 'function') {
      var original = console[level].bind(console)
      console[level] = function() {
        var args = Array.prototype.slice.call(arguments)
        try { safePost({ type:'log', level:String(level), context: contextLabel, messageParts: args }) } catch (_) {}
        original.apply(console, args)
      }
    }
  })
})()
`

  // Determine if this resource is a content script declared in manifest
  const declaredContentJsAbsPaths: string[] = []
  const contentScripts = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts
    : []

  for (const cs of contentScripts) {
    const jsList = Array.isArray(cs?.js) ? cs.js : []
    for (const js of jsList) {
      const abs = path.resolve(projectPath, js as string)
      declaredContentJsAbsPaths.push(abs)
    }
  }

  const isDeclaredContentScript = declaredContentJsAbsPaths.some(
    (abs) => resourceAbsPath === path.normalize(abs)
  )

  if (isDeclaredContentScript) {
    return `${loggerBootstrap}${source}`
  }

  return source
}
