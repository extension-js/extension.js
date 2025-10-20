import fs from 'fs'
import path from 'path'
import {validate} from 'schema-utils'
import {type Schema} from 'schema-utils/declarations/validate'
import {type LoaderContext} from '../../../../webpack-types'
import * as utils from '../../../../../develop-lib/utils'

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
  const manifest = utils.filterKeysForThisBrowser(rawManifest as any, browser)

  validate(schema, options, {
    name: 'scripts:add-centralized-logger-script-content',
    baseDataPath: 'options'
  })

  const resourceAbsPath = path.normalize(this.resourcePath)

  // Build UI logger bridge (content context)
  const loggerBootstrap = `
/* centralized content logger bootstrap */
(function() {
  var ctx = 'content';
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

  ['log','info','warn','error','debug'].forEach(function(lvl) {
    if (typeof console !== "undefined" && typeof console[lvl] === "function") {
      var orig = console[lvl].bind(console);
      console[lvl] = function() {
        var args = Array.prototype.slice.call(arguments);
        try { safePost({ type:'log', level:String(lvl), context: ctx, messageParts: args }); } catch (e) {}
        orig.apply(console, args);
      };
    }
  });
})();
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
