import * as path from 'path'
import * as fs from 'fs'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {LoaderInterface} from '../../../webpack-types'
import {getAssetsFromHtml} from '../html-lib/utils'

const schema: Schema = {
  type: 'object',
  properties: {
    test: {
      type: 'string'
    },
    manifestPath: {
      type: 'string'
    },
    includeList: {
      type: 'object'
    },
    browser: {
      type: 'string'
    }
  }
}

export default function addCentralizedLoggerScript(
  this: LoaderInterface,
  source: string
) {
  const options = this.getOptions()
  const manifestPath = options.manifestPath
  const projectPath = path.dirname(manifestPath)

  try {
    validate(schema, options, {
      name: 'html:add-centralized-logger-script',
      baseDataPath: 'options'
    })
  } catch (error) {
    throw error
  }

  const resourcePath = this.resourcePath || ''
  const normalizedResource = path.normalize(resourcePath)

  // Always inject a minimal dev accept guard so UI scripts live-reload in dev.
  // This is part of the centralized logger bootstrap prelude (not HMR-specific naming).
  const loggerPrelude = `
if (import.meta.webpackHot) { import.meta.webpackHot.accept() }
`

  // Avoid re-injecting if our UI bootstrap is already present
  if (source.includes('/* centralized ui logger bootstrap */')) {
    return `${loggerPrelude}${source}`
  }

  const includeList = (options.includeList || {}) as Record<
    string,
    string | undefined
  >

  // Map feature to UI context expected by the logger bridge
  const featureToContext = (featureKey: string): string => {
    const root = (featureKey || '').split('/')[0]
    if (root === 'action' || root === 'page_action') return 'popup'
    if (root === 'options' || root === 'options_ui' || root === 'options_page')
      return 'options'
    if (
      root === 'sidebar' ||
      root === 'sidebar_action' ||
      root === 'side_panel'
    )
      return 'sidebar'
    if (root === 'devtools') return 'devtools'
    return 'ui'
  }

  let matchedContext: string | undefined

  for (const [feature, htmlPath] of Object.entries(includeList)) {
    if (!htmlPath) continue
    if (!fs.existsSync(htmlPath)) continue

    const assets = getAssetsFromHtml(htmlPath)
    const jsAssets = assets?.js || []

    // Normalize asset paths to absolute filesystem paths where applicable
    const absAssets = jsAssets.map((p) => {
      if (p.startsWith('/')) {
        // Public-root URL → <project>/public/...
        return path.normalize(path.join(projectPath, 'public', p.slice(1)))
      }
      return path.normalize(p)
    })

    if (absAssets.some((p) => p === normalizedResource)) {
      matchedContext = featureToContext(feature)
      break
    }
  }

  if (matchedContext) {
    const loggerBridge = `
/* centralized ui logger bootstrap */
(function() {
  var ctx = ${JSON.stringify(matchedContext)};
  var port;
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.connect) {
    var targetId = (function(){
      if (typeof window !== 'undefined' && (window).__EXT_LOGGER_ID__) return String((window).__EXT_LOGGER_ID__);
      try {
        var u = new URL(typeof location !== 'undefined' ? String(location.href) : '');
        var v = u.searchParams.get('loggerId');
        if (v) return v;
      } catch {}
      return '';
    })();

      if (targetId) {
        try { port = chrome.runtime.connect(targetId, { name: 'logger' }); } catch (e) {}
      }
      if (!port) {
        try { port = chrome.runtime.connect({ name: 'logger' }); } catch (e) {}
      }

    // Best-effort late resolution via management API (requires permission in sender)
    if (!port && chrome.management && typeof chrome.management.getAll === 'function') {
      chrome.management.getAll(function(list){
        var found = (list||[]).find(function(it){ return it && typeof it.name === 'string' && it.name.toLowerCase().includes('centralized-logger'); });
        if (found && found.id) {
          try { port = chrome.runtime.connect(found.id, { name: 'logger' }); } catch (e) {}
        }
      });
    }
  }

  function safePost(msg) {
    if (port && port.postMessage) { port.postMessage(msg); }
  }

  ['log','info','warn','error','debug','trace'].forEach(function(lvl) {
    if (typeof console !== "undefined" && typeof console[lvl] === "function") {
      var orig = console[lvl].bind(console);
      console[lvl] = function() {
        var args = Array.prototype.slice.call(arguments);
        safePost({ type:'log', level:String(lvl), context: ctx, messageParts: args });
        orig.apply(console, args);
      };
    }
  });
  if (typeof console !== 'undefined' && typeof console.clear === 'function') {
    var _clear = console.clear.bind(console);
    console.clear = function(){ try { safePost({ type:'log', level:'info', context: ctx, messageParts:['console.clear'], meta: { kind: 'clear' } }) } catch (e) {} try { return _clear.apply(console, arguments) } catch (e) {} }
  }
})();
`
    return `${loggerPrelude}${loggerBridge}${source}`
  }

  // Not a UI page script we manage: only prepend the minimal prelude
  return `${loggerPrelude}${source}`
}
