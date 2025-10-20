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
    name: 'scripts:add-centralized-logger-script-background',
    baseDataPath: 'options'
  })

  const resourceAbsPath = path.normalize(this.resourcePath)
  const loggerBootstrap = `
/* centralized background logger bootstrap */
(function() {
  var loggerPort;
  var buffer = [];
  function tryConnect() {
    if (!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.connect)) return;
    var targetId = (function(){
      if (typeof self !== 'undefined' && (self).__EXT_LOGGER_ID__) return String((self).__EXT_LOGGER_ID__);
      try {
        var u = new URL(typeof location !== 'undefined' ? String(location.href) : '');
        var v = u.searchParams.get('loggerId');
        if (v) return v;
      } catch {}
      return '';
    })();
    if (!loggerPort && targetId) {
      try {
        loggerPort = chrome.runtime.connect(targetId, { name: 'logger' });
        flush();
        attachDisconnect();
      } catch (e) {}
    }
    // intentionally avoid local self-connection to prevent loops; only external connection should be used
    if (!loggerPort && chrome.management && typeof chrome.management.getAll === 'function') {
      chrome.management.getAll(function(list){
        var found = (list||[]).find(function(it){ return it && typeof it.name === 'string' && it.name.toLowerCase().includes('centralized-logger'); });
        if (found && found.id && !loggerPort) {
          try {
            loggerPort = chrome.runtime.connect(found.id, { name: 'logger' });
            flush();
            attachDisconnect();
          } catch (e) {}
        }
      });
    } else {
      attachDisconnect();
    }
  }
  function flush(){
    if (!loggerPort || !loggerPort.postMessage) return;
    var q = buffer; buffer = [];
    for (var i=0;i<q.length;i++) {
      try { loggerPort.postMessage(q[i]); } catch (e) {}
    }
  }
  function attachDisconnect(){
    if (loggerPort && loggerPort.onDisconnect && loggerPort.onDisconnect.addListener) {
      loggerPort.onDisconnect.addListener(function(){ loggerPort = null; });
    }
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.connect) {
    tryConnect();

    // Bridge: forward any internal ports named 'logger' (e.g., from content/UI) to centralized logger
    if (chrome.runtime && chrome.runtime.onConnect && chrome.runtime.onConnect.addListener) {
      chrome.runtime.onConnect.addListener(function(port) {
        if (!port || port.name !== 'logger') return;
        port.onMessage.addListener(function(msg){
          if (!loggerPort) { tryConnect(); }
          if (loggerPort && loggerPort.postMessage) { loggerPort.postMessage(msg); }
          else { buffer.push(msg); }
        });
      });
    }
  }

  function safePost(msg) {
    try {
      if (!loggerPort) { tryConnect(); }
      if (loggerPort && loggerPort.postMessage) { loggerPort.postMessage(msg); }
      else { buffer.push(msg); }
    } catch (e) {}
  }

  if (typeof self !== "undefined" && self.addEventListener) {
    self.addEventListener('error', function(e) {
      safePost({ type: 'log', level: 'error', context: 'background', messageParts: [ String(e && e.message || ''), String(e && e.filename || ''), e && e.lineno, e && e.colno ] });
    });

    self.addEventListener('unhandledrejection', function(e) {
      var reason = '';
      if (e && typeof e.reason !== "undefined") {
        try { reason = typeof e.reason === "string" ? e.reason : JSON.stringify(e.reason); } catch (_) { reason = String(e.reason); }
      }
      safePost({ type: 'log', level: 'error', context: 'background', messageParts: ['Unhandled Rejection', reason] });
    });
  }

  ['log','info','warn','error','debug'].forEach(function(lvl) {
    if (typeof console !== "undefined" && typeof console[lvl] === "function") {
      var orig = console[lvl].bind(console);
      console[lvl] = function() {
        var args = Array.prototype.slice.call(arguments);
        safePost({ type: 'log', level: String(lvl), context: 'background', messageParts: args });
        orig.apply(console, args);
      };
    }
  });
})();
  `

  // 1 - Handle background.scripts and background.service_worker.
  // For service_worker, we now also inject HMR registration.
  if (manifest.background) {
    // Handle background.scripts (MV2)
    if (manifest.background.scripts) {
      for (const bgScript of manifest.background.scripts) {
        const absoluteUrl = path.resolve(projectPath, bgScript as string)
        if (resourceAbsPath === path.normalize(absoluteUrl)) {
          return `${loggerBootstrap}${source}`
        }
      }
    }
    // Handle background.service_worker (MV3)
    if (manifest.background.service_worker) {
      const swPath = manifest.background.service_worker
      const absoluteSwPath = path.resolve(projectPath, swPath as string)
      if (resourceAbsPath === path.normalize(absoluteSwPath)) {
        return `${loggerBootstrap}${source}`
      }
    }
  }

  return source
}
