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

  // Forward page window.postMessage events from injected page script -> background
  window.addEventListener('message', function(ev){
    try {
      var data = (ev && ev.data) || {};
      if (!data || data.__reactLogger !== true || data.type !== 'log') return;
      safePost({ type: 'log', level: String(data.level || 'log'), context: 'page', messageParts: Array.isArray(data.messageParts) ? data.messageParts : [data.messageParts], url: data.url });
    } catch (e) {}
  });

  // Inject a page-context script that patches console.* to post window messages
    var s = document.createElement('script');
    s.textContent = '(function(){try{var post=function(m){try{window.postMessage(m,"*");}catch(_){}};\
window.addEventListener("error",function(e){post({__reactLogger:true,type:"log",level:"error",messageParts:[String(e&&e.message||""),String(e&&e.filename||""),e&&e.lineno,e&&e.colno],url:String(location&&location.href||"")});});\
window.addEventListener("unhandledrejection",function(e){var r="";try{r=typeof e.reason==="string"?e.reason:JSON.stringify(e.reason);}catch(_){r=String(e.reason);}post({__reactLogger:true,type:"log",level:"error",messageParts:["Unhandled Rejection",r],url:String(location&&location.href||"")});});\
["log","info","warn","error","debug"].forEach(function(k){try{var o=console[k]&&console[k].bind?console[k].bind(console):console[k];console[k]=function(){var a=[].slice.call(arguments);post({__reactLogger:true,type:"log",level:k,messageParts:a,url:String(location&&location.href||"")});try{return o&&o.apply?o.apply(console,a):void 0;}catch(_){}}}catch(_){}});}catch(_){}})();';
    (document.documentElement || document.head || document.body).appendChild(s);

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
