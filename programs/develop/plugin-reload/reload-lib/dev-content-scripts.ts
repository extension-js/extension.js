// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  getCanonicalContentScriptEntryName,
  parseCanonicalContentScriptAsset
} from '../../plugin-web-extension/feature-scripts/contracts'
import type {Manifest} from '../../types'

// Chromium loads a static content script's bytes once, at extension load, so
// an edit can never reach a page through the manifest entry. In development
// the manifest entry becomes a stub that only signals the worker, the real
// bundles are registered at runtime from this registry, and a marker each
// bundle sets on its world lets every injection path skip a frame that
// already runs the current file.
export const DEV_CONTENT_SCRIPT_REGISTRY_ASSET =
  'content_scripts/dev-registry.json'
export const DEV_CONTENT_SCRIPT_MARKER_KEY = '__extjsDevContentScripts'
export const DEV_CONTENT_SCRIPT_STUB_MESSAGE_KEY = '__extjsDevCsStub'
export const DEV_CONTENT_SCRIPT_ID_PREFIX = 'extjs-dev-cs-'

export interface DevContentScriptRegistryEntry {
  id: string
  entry: string
  matches: string[]
  excludeMatches?: string[]
  js: string[]
  css: string[]
  runAt: 'document_start' | 'document_end' | 'document_idle'
  allFrames: boolean
  world: 'ISOLATED' | 'MAIN'
  matchOriginAsFallback?: boolean
  // Globs have no dynamic-registration form, so the static stub alone decides
  // where such an entry runs and the worker injects on its signal.
  stubOnly: boolean
}

export interface DevContentScriptRegistry {
  version: 1
  entries: DevContentScriptRegistryEntry[]
}

export interface DevContentScriptPlan {
  manifest: Manifest
  registry: DevContentScriptRegistry
  stubs: Record<string, string>
}

type ContentScriptEntry = Record<string, unknown>

export function devContentScriptStubAssetName(index: number): string {
  return `content_scripts/dev-stub-${index}.js`
}

const HASHED_CONTENT_SCRIPT_ASSET =
  /^content_scripts\/content-(\d+)(?:\.[a-f0-9]+)?\.js$/i

// The canonical entry an emitted content script bundle belongs to, or
// undefined for anything else under content_scripts/ (stubs, css, maps).
export function contentScriptEntryForAsset(
  assetName: string
): string | undefined {
  const match = HASHED_CONTENT_SCRIPT_ASSET.exec(assetName)
  if (!match) return undefined

  return getCanonicalContentScriptEntryName(Number(match[1]))
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function runAtOf(
  value: unknown
): 'document_start' | 'document_end' | 'document_idle' {
  if (value === 'document_start' || value === 'document_end') return value

  return 'document_idle'
}

function canonicalIndexOf(entry: ContentScriptEntry): number | undefined {
  for (const file of [...stringList(entry.js), ...stringList(entry.css)]) {
    const parsed = parseCanonicalContentScriptAsset(file)
    if (parsed) return parsed.index
  }

  return undefined
}

// Rewrites a development manifest so each content_scripts entry ships a stub
// and returns the registry the worker registers from. Undefined when nothing
// applies: no entries, or none that name a compiled bundle.
export function planDevContentScripts(
  manifest: Manifest
): DevContentScriptPlan | undefined {
  if (manifest.manifest_version !== 3) return undefined

  const groups = manifest.content_scripts as ContentScriptEntry[] | undefined
  if (!Array.isArray(groups) || groups.length === 0) return undefined

  const entries: DevContentScriptRegistryEntry[] = []
  const stubs: Record<string, string> = {}
  const nextGroups = groups.map((group) => {
    const index = canonicalIndexOf(group)
    const matches = stringList(group.matches)
    const js = stringList(group.js)
    const css = stringList(group.css)

    if (index === undefined || matches.length === 0) return group
    if (js.length === 0 && css.length === 0) return group

    const entryName = getCanonicalContentScriptEntryName(index)
    const excludeMatches = stringList(group.exclude_matches)
    const stubOnly =
      stringList(group.include_globs).length > 0 ||
      stringList(group.exclude_globs).length > 0

    entries.push({
      id: `${DEV_CONTENT_SCRIPT_ID_PREFIX}${index}`,
      entry: entryName,
      matches,
      ...(excludeMatches.length > 0 ? {excludeMatches} : {}),
      js,
      css,
      runAt: runAtOf(group.run_at),
      allFrames: group.all_frames === true,
      world: group.world === 'MAIN' ? 'MAIN' : 'ISOLATED',
      ...(group.match_origin_as_fallback === true
        ? {matchOriginAsFallback: true}
        : {}),
      stubOnly
    })

    const stubAsset = devContentScriptStubAssetName(index)
    stubs[stubAsset] = buildDevContentScriptStubSource(entryName)

    // The stub only signals, so it runs isolated even for a MAIN world entry;
    // the registry keeps the world the real bundle runs in.
    const {css: _css, world: _world, ...rest} = group

    return {...rest, js: [stubAsset]}
  })

  if (entries.length === 0) return undefined

  return {
    manifest: {...manifest, content_scripts: nextGroups} as Manifest,
    registry: {version: 1, entries},
    stubs
  }
}

// The static entry's whole job: tell the worker this frame reached the
// entry's run_at, so it can inject the current bundle if Chromium did not.
export function buildDevContentScriptStubSource(entryName: string): string {
  return (
    ';(function(){try{var c=globalThis.chrome;' +
    'if(!c||!c.runtime||!c.runtime.sendMessage)return;' +
    `c.runtime.sendMessage({${DEV_CONTENT_SCRIPT_STUB_MESSAGE_KEY}:{entry:${JSON.stringify(entryName)}}},` +
    'function(){try{void c.runtime.lastError}catch(e){}})}catch(e){}})();\n'
  )
}

// Prepended to every emitted content script bundle: the world it runs in
// remembers which file of which entry ran, so a second copy is never added.
export function buildDevContentScriptMarkerPrelude(
  entryName: string,
  assetName: string
): string {
  return (
    `;(function(){try{var g=globalThis,k=${JSON.stringify(DEV_CONTENT_SCRIPT_MARKER_KEY)};` +
    `(g[k]=g[k]||{})[${JSON.stringify(entryName)}]=${JSON.stringify(assetName)}}catch(e){}})();\n`
  )
}

// Worker-side runtime, prepended to the background bundle. Registers the
// registry's entries at boot, injects on a stub's signal, heals open tabs
// after a worker restart and reloads the tabs an edited entry matches. The
// bridge producer calls the two exported hooks and falls back to its own
// manifest path when this runtime is absent (Firefox, MV2, no worker).
export const DEV_CONTENT_SCRIPTS_RUNTIME_SOURCE = `;(function () {
  try {
    var g = (typeof globalThis !== "undefined" ? globalThis : self);
    if (!g || g.__extjsDevContentScriptsInstalled) return;
    var chrome = g.chrome;
    if (!chrome || !chrome.runtime || !chrome.scripting || !chrome.tabs) return;
    g.__extjsDevContentScriptsInstalled = true;

    var REGISTRY = ${JSON.stringify(DEV_CONTENT_SCRIPT_REGISTRY_ASSET)};
    var MARKER = ${JSON.stringify(DEV_CONTENT_SCRIPT_MARKER_KEY)};
    var STUB = ${JSON.stringify(DEV_CONTENT_SCRIPT_STUB_MESSAGE_KEY)};
    var ID_PREFIX = ${JSON.stringify(DEV_CONTENT_SCRIPT_ID_PREFIX)};
    var registry = null;
    var ready = false;
    var whenReady = [];

    function noop() { try { void chrome.runtime.lastError; } catch (e) {
      // Ignore
    } }
    function isString(v) { return typeof v === "string"; }
    function injectableUrl(url) { return typeof url === "string" && /^(https?|file|ftp):/i.test(url); }
    function call(fn) { if (fn) { try { fn(); } catch (e) {
      // Ignore
    } } }
    function onReady(fn) { if (ready) call(fn); else whenReady.push(fn); }
    function markReady() {
      ready = true;
      var fns = whenReady;
      whenReady = [];
      for (var i = 0; i < fns.length; i++) call(fns[i]);
    }

    // The registry is read FROM DISK every time: the bundles it names are
    // content-hashed and the worker outlives many edits.
    function load(cb) {
      try {
        if (typeof g.fetch !== "function") return cb(null);
        g.fetch(chrome.runtime.getURL(REGISTRY), {cache: "no-store"})
          .then(function (r) { return r && r.ok ? r.json() : null; })
          .then(function (reg) { cb(reg && Array.isArray(reg.entries) ? reg : null); })
          .catch(function () { cb(null); });
      } catch (e) { cb(null); }
    }

    function registrationOf(e) {
      var s = {
        id: e.id,
        matches: e.matches,
        runAt: e.runAt === "document_start" || e.runAt === "document_end" ? e.runAt : "document_idle",
        allFrames: !!e.allFrames,
        world: e.world === "MAIN" ? "MAIN" : "ISOLATED",
        persistAcrossSessions: false
      };
      var js = (e.js || []).filter(isString), css = (e.css || []).filter(isString);
      if (Array.isArray(e.excludeMatches) && e.excludeMatches.length) s.excludeMatches = e.excludeMatches;
      if (js.length) s.js = js;
      if (css.length) s.css = css;
      if (e.matchOriginAsFallback) s.matchOriginAsFallback = true;
      return s;
    }

    // Register what the registry names, update what is already registered,
    // drop dev registrations it no longer names. Idempotent per entry id.
    function sync(reg, done) {
      try {
        if (!chrome.scripting.registerContentScripts || !chrome.scripting.getRegisteredContentScripts) return call(done);
        var wanted = [];
        for (var i = 0; i < reg.entries.length; i++) {
          var e = reg.entries[i] || {};
          if (e.stubOnly || !isString(e.id) || !Array.isArray(e.matches) || !e.matches.length) continue;
          var r = registrationOf(e);
          if (!r.js && !r.css) continue;
          wanted.push(r);
        }
        chrome.scripting.getRegisteredContentScripts(function (existing) {
          noop();
          var have = {};
          if (existing) {
            for (var k = 0; k < existing.length; k++) {
              if (existing[k] && isString(existing[k].id)) have[existing[k].id] = true;
            }
          }
          var toRegister = [], toUpdate = [], toDrop = [], keep = {};
          for (var j = 0; j < wanted.length; j++) {
            keep[wanted[j].id] = true;
            (have[wanted[j].id] ? toUpdate : toRegister).push(wanted[j]);
          }
          for (var id in have) {
            if (id.indexOf(ID_PREFIX) === 0 && !keep[id]) toDrop.push(id);
          }
          var ops = [];
          if (toDrop.length && chrome.scripting.unregisterContentScripts) ops.push(["unregisterContentScripts", {ids: toDrop}]);
          if (toUpdate.length && chrome.scripting.updateContentScripts) ops.push(["updateContentScripts", toUpdate]);
          if (toRegister.length) ops.push(["registerContentScripts", toRegister]);
          var pending = ops.length;
          if (!pending) return call(done);
          var step = function () { pending--; if (pending <= 0) call(done); };
          for (var o = 0; o < ops.length; o++) {
            try { chrome.scripting[ops[o][0]](ops[o][1], function () { noop(); step(); }); } catch (e) { step(); }
          }
        });
      } catch (e) { call(done); }
    }

    // Inject one entry into the frames of a tab whose world does not already
    // run the current file. Chromium's own injection sets the same marker,
    // so a frame it covered is skipped and nothing ever runs twice.
    function inject(e, target, done) {
      var world = e.world === "MAIN" ? "MAIN" : "ISOLATED";
      var js = (e.js || []).filter(isString), css = (e.css || []).filter(isString);
      var probe = {target: target, world: world, injectImmediately: true, args: [MARKER, e.entry, js[0] || ""],
        func: function (key, entry, file) { try { var m = globalThis[key]; return !!(m && m[entry] === file); } catch (x) { return false; } }};
      try {
        chrome.scripting.executeScript(probe, function (results) {
          noop();
          var frameIds = [];
          if (results) {
            for (var i = 0; i < results.length; i++) {
              var r = results[i];
              if (!r || r.result === true) continue;
              frameIds.push(typeof r.frameId === "number" ? r.frameId : 0);
            }
          }
          if (!frameIds.length) return call(done);
          var into = {tabId: target.tabId, frameIds: frameIds};
          if (css.length && chrome.scripting.insertCSS) {
            try { chrome.scripting.insertCSS({target: into, files: css}, noop); } catch (x) {
              // Ignore
            }
          }
          if (!js.length) return call(done);
          try {
            chrome.scripting.executeScript({target: into, files: js, world: world, injectImmediately: true}, function () { noop(); call(done); });
          } catch (x) { call(done); }
        });
      } catch (x) { call(done); }
    }

    // The open tabs an entry matches, exclude_matches honored, tabs still
    // loading skipped when asked: Chromium injects those itself on landing.
    function tabsFor(e, completeOnly, cb) {
      var matches = Array.isArray(e.matches) ? e.matches : [];
      if (!matches.length) return cb([]);
      var excludes = Array.isArray(e.excludeMatches) ? e.excludeMatches : [];
      var collect = function (excludedIds) {
        try {
          chrome.tabs.query({url: matches}, function (tabs) {
            noop();
            var out = [];
            for (var i = 0; tabs && i < tabs.length; i++) {
              var t = tabs[i];
              if (!t || t.id == null || !injectableUrl(t.url) || excludedIds[t.id]) continue;
              if (completeOnly && t.status === "loading") continue;
              out.push(t);
            }
            cb(out);
          });
        } catch (x) { cb([]); }
      };
      if (!excludes.length) return collect({});
      try {
        chrome.tabs.query({url: excludes}, function (tabs) {
          noop();
          var ids = {};
          for (var i = 0; tabs && i < tabs.length; i++) if (tabs[i] && tabs[i].id != null) ids[tabs[i].id] = true;
          collect(ids);
        });
      } catch (x) { collect({}); }
    }

    function onStub(msg, sender) {
      if (!msg || !isString(msg.entry) || !sender || !sender.tab || sender.tab.id == null) return;
      var tabId = sender.tab.id;
      var frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
      onReady(function () {
        if (!registry) return;
        for (var i = 0; i < registry.entries.length; i++) {
          var e = registry.entries[i];
          if (e && e.entry === msg.entry) inject(e, {tabId: tabId, frameIds: [frameId]});
        }
      });
    }

    // After a worker restart the open tabs still run the previous generation,
    // and Chromium never injects into a tab that finished loading before it.
    function heal(done) {
      onReady(function () {
        if (!registry) return call(done);
        var pending = 1;
        var step = function () { pending--; if (pending <= 0) call(done); };
        for (var i = 0; i < registry.entries.length; i++) {
          (function (e) {
            if (!e || e.stubOnly) return;
            pending++;
            tabsFor(e, true, function (tabs) {
              var left = tabs.length;
              if (!left) return step();
              for (var t = 0; t < tabs.length; t++) {
                inject(e, {tabId: tabs[t].id, allFrames: !!e.allFrames}, function () { if (--left === 0) step(); });
              }
            });
          })(registry.entries[i]);
        }
        step();
      });
    }

    // A content script edit: re-register at the new files, then reload every
    // tab the edited entries match so each runs exactly one fresh copy. Returns
    // false when no registry exists, and the caller keeps its own path.
    function reload(names, done) {
      load(function (reg) {
        if (!reg) return call(function () { done(false); });
        registry = reg;
        sync(reg, function () {
          markReady();
          var wanted = Array.isArray(names) && names.length ? names : null;
          var seen = {};
          var pending = 1;
          var step = function () { pending--; if (pending <= 0) call(function () { done(true); }); };
          for (var i = 0; i < reg.entries.length; i++) {
            (function (e) {
              if (!e || (wanted && wanted.indexOf(e.entry) === -1)) return;
              pending++;
              tabsFor(e, false, function (tabs) {
                for (var t = 0; t < tabs.length; t++) {
                  var id = tabs[t].id;
                  if (seen[id]) continue;
                  seen[id] = true;
                  try { chrome.tabs.reload(id, {}, noop); } catch (x) {
                    // Ignore
                  }
                }
                step();
              });
            })(reg.entries[i]);
          }
          step();
        });
      });
    }

    try {
      chrome.runtime.onMessage.addListener(function (msg, sender) {
        if (!msg || !msg[STUB]) return;
        onStub(msg[STUB], sender);
      });
    } catch (e) {
      // Ignore
    }

    g.__extjsDevContentScripts = {heal: heal, reload: reload, isReady: function () { return ready; }};

    load(function (reg) {
      registry = reg;
      if (!reg) return markReady();
      sync(reg, markReady);
    });
  } catch (e) {
    // Ignore
  }
})();
`
