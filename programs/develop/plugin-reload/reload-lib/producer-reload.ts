// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  type BuildProducerOptions,
  buildBridgeProducerSource,
  type ProducerExecutor
} from '../../dev-server/control-bridge/producer-runtime'
import type {DevSessionCoordinates} from '../../lib/dev-session-coordinates'

// What a dev background runs when a reload frame arrives: re-inject, the
// script addresses, the sheet swaps, the page tabs and the restart.
const RELOAD_HANDLERS = `    // The manifest glob dialect: * is any run of characters, ? exactly one,
    // and the pattern covers the whole url.
    function globMatches(glob, text) {
      var gi = 0, ti = 0, star = -1, mark = 0;
      while (ti < text.length) {
        if (gi < glob.length && (glob.charAt(gi) === "?" || glob.charAt(gi) === text.charAt(ti))) { gi++; ti++; }
        else if (gi < glob.length && glob.charAt(gi) === "*") { star = gi++; mark = ti; }
        else if (star !== -1) { gi = star + 1; ti = ++mark; }
        else return false;
      }
      while (gi < glob.length && glob.charAt(gi) === "*") gi++;
      return gi === glob.length;
    }

    // include_globs narrows matches and exclude_globs removes from them, the
    // same way the browser decides where the built extension runs.
    function passesGlobs(url, includeGlobs, excludeGlobs) {
      var u = String(url || "");
      var i;
      if (includeGlobs.length) {
        var included = false;
        for (i = 0; i < includeGlobs.length; i++) {
          if (globMatches(includeGlobs[i], u)) { included = true; break; }
        }
        if (!included) return false;
      }
      for (i = 0; i < excludeGlobs.length; i++) {
        if (globMatches(excludeGlobs[i], u)) return false;
      }
      return true;
    }

    // Re-inject one declared entry's fresh files into every matching open tab.
    // exclude_matches MUST be honored: query the excludes and subtract them.
    // opts.completeOnly skips a tab still loading: Chrome injects the static
    // script into it when it lands, and a second copy here would run twice.
    function reinjectContentScriptEntry(entry, opts) {
      var chrome = g.chrome;
      var completeOnly = !!(opts && opts.completeOnly);
      var matches = (entry && entry.matches) || [];
      if (!Array.isArray(matches) || !matches.length) return;
      var excludeMatches = (entry && entry.exclude_matches) || [];
      var includeGlobs = stringList(entry && entry.include_globs);
      var excludeGlobs = stringList(entry && entry.exclude_globs);
      var jsFiles = ((entry && entry.js) || []).filter(function (f) { return typeof f === "string"; });
      var cssFiles = ((entry && entry.css) || []).filter(function (f) { return typeof f === "string"; });
      if (!jsFiles.length && !cssFiles.length) return;
      var world = entry.world === "MAIN" ? "MAIN" : "ISOLATED";
      var allFrames = !!entry.all_frames;
      function injectInto(excludedTabIds) {
        try {
          chrome.tabs.query({url: matches}, function (tabs) {
            var err = null;
            try { err = chrome.runtime.lastError; } catch (e) {
              // A throwing lastError read leaves err null so the tabs still get used
            }
            if (err || !tabs) return;
            for (var i = 0; i < tabs.length; i++) {
              (function (tab) {
                if (!tab || tab.id == null || !isInjectableUrl(tab.url)) return;
                if (excludedTabIds[tab.id]) return;
                if (!passesGlobs(tab.url, includeGlobs, excludeGlobs)) return;
                if (completeOnly && tab.status === "loading") return;
                var target = {tabId: tab.id, allFrames: allFrames};
                if (cssFiles.length && chrome.scripting.insertCSS) {
                  try { chrome.scripting.insertCSS({target: target, files: cssFiles}, noopLastError); } catch (e) {
                    // A tab that closed or forbids CSS since the query has nothing to swap
                  }
                }
                if (jsFiles.length && chrome.scripting.executeScript) {
                  try {
                    chrome.scripting.executeScript(
                      {target: target, files: jsFiles, world: world, injectImmediately: true},
                      noopLastError
                    );
                  } catch (e) {
                    // A tab that closed or forbids scripts since the query is skipped
                  }
                }
              })(tabs[i]);
            }
          });
        } catch (e) {
          // No tabs API in this background means no open tab to re-inject into
        }
      }
      if (Array.isArray(excludeMatches) && excludeMatches.length) {
        try {
          chrome.tabs.query({url: excludeMatches}, function (excludedTabs) {
            try { void chrome.runtime.lastError; } catch (e) {
              // Reading lastError only marks it seen so the browser logs nothing
            }
            var excluded = {};
            if (excludedTabs) {
              for (var i = 0; i < excludedTabs.length; i++) {
                if (excludedTabs[i] && excludedTabs[i].id != null) excluded[excludedTabs[i].id] = true;
              }
            }
            injectInto(excluded);
          });
          return;
        } catch (e) {
          // A refused exclude query falls through to injecting with no excludes
        }
      }
      injectInto({});
    }

    // Re-inject all content scripts into their open tabs. Reads the manifest
    // FROM DISK: getManifest() is frozen and dev filenames are content-hashed.
    // opts.register false skips the dynamic registration: at boot the static
    // manifest already names the current files, and a copy injects twice.
    // onFailed runs when the manifest cannot be read after true was returned,
    // so the caller that was told to wait still gets its fallback.
    function reinjectContentScripts(onDone, opts, onFailed) {
      var chrome = g.chrome;
      var register = !opts || opts.register !== false;
      try {
        if (typeof g.fetch !== "function" || !chrome.scripting) return false;
        g.fetch(chrome.runtime.getURL("manifest.json"), {cache: "no-store"})
          .then(function (r) { return r.json(); })
          .then(function (manifest) {
            var entries = (manifest && manifest.content_scripts) || [];
            for (var i = 0; i < entries.length; i++) reinjectContentScriptEntry(entries[i], opts);
            if (register) reregisterForFutureNavigations(entries);
            if (onDone) { try { onDone(); } catch (e) {
              // A throw in the caller's callback must not undo the finished reinject
            } }
          })
          .catch(function (error) {
            try {
              g.console.warn(
                "Extension.js W_RELOAD_NOT_APPLIED: manifest.json could not be read to reinject the content scripts, so " +
                  (onFailed ? "the extension reloads instead." : "open tabs keep the scripts they have."),
                String(error)
              );
            } catch (e) {
              // A background without a console still gets the fallback below
            }
            if (onFailed) { try { onFailed(); } catch (e) {
              // A throwing fallback has nothing behind it to fall back to
            } }
          });
        return true;
      // False sends the caller to a full restart instead of a reinject
      } catch (e) { return false; }
    }

    function mapRunAt(runAt) {
      if (runAt === "document_start") return "document_start";
      if (runAt === "document_end") return "document_end";
      return "document_idle";
    }

    // Re-register content scripts dynamically at the fresh files, so tabs
    // opened AFTER an edit also get the new build. Idempotent per entry id.
    function reregisterForFutureNavigations(entries) {
      var chrome = g.chrome;
      if (
        !chrome.scripting ||
        !chrome.scripting.registerContentScripts ||
        !chrome.scripting.getRegisteredContentScripts
      ) return;

      var scripts = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i] || {};
        if (!Array.isArray(e.matches) || !e.matches.length) continue;
        // registerContentScripts has no glob keys, so a copy of a globbed
        // entry would run on pages the built extension never reaches.
        if (stringList(e.include_globs).length || stringList(e.exclude_globs).length) continue;
        var js = (e.js || []).filter(function (f) { return typeof f === "string"; });
        var css = (e.css || []).filter(function (f) { return typeof f === "string"; });
        if (!js.length && !css.length) continue;
        // Every field is sent: updateContentScripts keeps any key left out, so
        // a dropped exclude_matches, css file or fallback would outlive the edit.
        scripts.push({
          id: "extjs-dev-cs-" + i,
          matches: e.matches,
          excludeMatches: (e.exclude_matches || []).filter(function (p) { return typeof p === "string"; }),
          js: js,
          css: css,
          runAt: mapRunAt(e.run_at),
          allFrames: !!e.all_frames,
          world: e.world === "MAIN" ? "MAIN" : "ISOLATED",
          matchOriginAsFallback: e.match_origin_as_fallback === true,
          // A browser restart loads the static manifest fresh; a copy that
          // outlived the session would inject every page twice.
          persistAcrossSessions: false
        });
      }
      if (!scripts.length) return;

      try {
        chrome.scripting.getRegisteredContentScripts(function (existing) {
          try { void chrome.runtime.lastError; } catch (e) {
            // Reading lastError only marks it seen so the browser logs nothing
          }
          var have = {};
          if (existing) for (var k = 0; k < existing.length; k++) have[existing[k].id] = true;
          var toRegister = [], toUpdate = [];
          for (var j = 0; j < scripts.length; j++) {
            (have[scripts[j].id] ? toUpdate : toRegister).push(scripts[j]);
          }
          if (toRegister.length) {
            try { chrome.scripting.registerContentScripts(toRegister, noopLastError); } catch (e) {
              // A refused registration only costs later tabs the fresh files
            }
          }
          if (toUpdate.length) {
            try { chrome.scripting.updateContentScripts(toUpdate, noopLastError); } catch (e) {
              // A refused update keeps the old registration until the next restart
            }
          }
        });
      } catch (e) {
        // No registry read means no dynamic copies, the static manifest stays
      }
    }

    // The dev content-script runtime (plugin-reload) owns registration, the
    // boot heal and the tab reloads when its registry exists; absent, the
    // manifest-based paths below stay in charge.
    function devContentScripts() {
      // A background with no readable global has no dev registry to use
      try { return g.__extjsDevContentScripts || null; } catch (e) { return null; }
    }

    // An extension reload unloads chrome_url_overrides, and Chromium leaves
    // the open override tabs on its stock page. Only a fresh navigation to the
    // browser url (a tab reload does not) picks the override up again.
    var OVERRIDE_TABS_KEY = "__extjsDevOverrideTabs";
    var OVERRIDE_KINDS = ["newtab", "history", "bookmarks"];

    function overriddenKinds() {
      var m = null;
      // No manifest to read means no override pages to bring back
      try { m = g.chrome.runtime.getManifest(); } catch (e) { return []; }
      var o = m && m.chrome_url_overrides;
      var out = [];
      if (!o) return out;
      for (var i = 0; i < OVERRIDE_KINDS.length; i++) {
        if (typeof o[OVERRIDE_KINDS[i]] === "string" && o[OVERRIDE_KINDS[i]]) out.push(OVERRIDE_KINDS[i]);
      }
      return out;
    }

    // chrome://newtab/, edge://history and the like. Gecko shows about: urls
    // there, which this never matches, so other engines record nothing.
    function overrideKindOf(url, kinds) {
      var match = /^[a-z-]+:[/][/]([a-z]+)[/]?(?:[?#].*)?$/.exec(String(url || ""));
      return match && kinds.indexOf(match[1]) !== -1 ? match[1] : null;
    }

    // A reload closes the extension's own tabs on Chromium and leaves them on
    // the old document on Gecko, so the next generation brings each one back.
    var PAGE_TABS_KEY = "__extjsDevPageTabs";

    function ownPageUrl(url) {
      var base = "";
      try { base = String(g.chrome.runtime.getURL("")); } catch (e) {
        // An unreadable base URL matches no tab as the extension's own page
      }
      return !!base && typeof url === "string" && url.indexOf(base) === 0;
    }

    // Records the override tabs and the extension's own page tabs, and answers
    // with the former. The guard keeps a silent tabs.query off the reload.
    function rememberOverrideTabs(cb) {
      var chrome = g.chrome;
      var answered = false;
      var guard = null;
      var answer = function (list) {
        if (answered) return;
        answered = true;
        if (guard) { try { clearTimeout(guard); } catch (e) {
          // A guard timer that cannot be cleared only finds the answer given
        } }
        try { cb(list); } catch (e) {
          // A throw in the caller's callback must not stop the restart
        }
      };
      var kinds = overriddenKinds();
      if (!chrome.tabs || !chrome.tabs.query || !chrome.storage || !chrome.storage.local) return answer([]);
      try { guard = setTimeout(function () { answer([]); }, 1000); } catch (e) {
        // Without a guard timer the tabs query answer still settles the call
      }
      try {
        chrome.tabs.query({}, function (tabs) {
          noopLastError();
          var list = [];
          var pages = [];
          for (var i = 0; tabs && i < tabs.length; i++) {
            var t = tabs[i];
            if (!t || t.id == null) continue;
            var kind = kinds.length ? overrideKindOf(t.url, kinds) : null;
            if (kind) list.push({tabId: t.id, surface: kind, url: t.url});
            else if (ownPageUrl(t.url)) {
              pages.push({tabId: t.id, url: t.url, windowId: t.windowId, index: t.index, active: t.active === true, pinned: t.pinned === true});
            }
          }
          if (!list.length && !pages.length) return answer(list);
          try {
            var rec = {};
            if (list.length) rec[OVERRIDE_TABS_KEY] = {at: Date.now(), tabs: list};
            if (pages.length) rec[PAGE_TABS_KEY] = {at: Date.now(), tabs: pages};
            chrome.storage.local.set(rec, function () { noopLastError(); answer(list); });
          // Unrecorded tabs only stay on the stock page, the restart goes on
          } catch (e) { answer([]); }
        });
      // A refused tabs query records nothing and the restart goes on
      } catch (e) { answer([]); }
    }

    // Shared by every path that restarts the extension, so none of them
    // strands the override tabs.
    function restartExtension(delayMs, onRecorded) {
      // Every restart path flags the next generation's heal, so open tabs get
      // their content scripts back whichever path asked for the reload.
      try {
        if (g.chrome && g.chrome.storage && g.chrome.storage.local) {
          g.chrome.storage.local.set({__extjsDevPendingReinject: Date.now()}, noopLastError);
        }
      } catch (e) {
        // An unwritten heal flag only skips the next generation's tab heal
      }
      rememberOverrideTabs(function (list) {
        if (onRecorded) { try { onRecorded(list); } catch (e) {
          // A throw in the caller's callback must not stop the restart
        } }
        try { setTimeout(function () { try { g.chrome.runtime.reload(); } catch (e) {
          // A context already torn down is reloading or gone, nothing to do
        } }, delayMs); } catch (e) {
          // A live background always has setTimeout, this only shields the call
        }
      });
    }
    g.__extjsDevRestartExtension = restartExtension;

    // The new generation sends each recorded tab back to its browser url, once,
    // unless the tab has navigated elsewhere since.
    function restoreOverrideTabsAtBoot() {
      var chrome = g.chrome;
      if (!chrome || !chrome.storage || !chrome.storage.local || !chrome.tabs || !chrome.tabs.update) return;
      chrome.storage.local.get(OVERRIDE_TABS_KEY, function (res) {
        noopLastError();
        var rec = res && res[OVERRIDE_TABS_KEY];
        if (!rec || typeof rec !== "object" || !Array.isArray(rec.tabs)) return;
        try { chrome.storage.local.remove(OVERRIDE_TABS_KEY, noopLastError); } catch (e) {
          // A record left behind expires after 30 seconds and is ignored then
        }
        if (typeof rec.at !== "number" || Date.now() - rec.at > 30000) return;
        var kinds = overriddenKinds();
        setTimeout(function () {
          for (var i = 0; i < rec.tabs.length; i++) {
            (function (t) {
              if (!t || t.tabId == null || kinds.indexOf(t.surface) === -1) return;
              var go = function () {
                try { chrome.tabs.update(t.tabId, {url: t.url}, noopLastError); } catch (e) {
                  // A tab closed since the restart has no override page to bring back
                }
              };
              if (!chrome.tabs.get) return go();
              try {
                chrome.tabs.get(t.tabId, function (tab) {
                  noopLastError();
                  if (tab && overrideKindOf(tab.url, kinds) === t.surface) go();
                });
              } catch (e) {
                // A refused tab lookup leaves that tab on the stock page it shows
              }
            })(rec.tabs[i]);
          }
        }, 250);
      });
    }

    function reopenPageTab(page) {
      var chrome = g.chrome;
      var plain = function () {
        try { chrome.tabs.create({url: page.url, active: page.active === true}, noopLastError); } catch (e) {
          // A tab the browser refuses to open stays closed, the boot goes on
        }
      };
      try {
        chrome.tabs.create(
          {url: page.url, windowId: page.windowId, index: page.index, active: page.active === true, pinned: page.pinned === true},
          function () {
            var failed = false;
            try { failed = !!chrome.runtime.lastError; } catch (e) {
              // A throwing lastError read counts as success, the tab was created
            }
            // The window went with its last tab, so any window will do.
            if (failed) plain();
          }
        );
      // A refused placement opens the page in any window instead
      } catch (e) { plain(); }
    }

    // A tab still open is reloaded, one the browser closed is opened again
    // unless the extension did so itself. Each recorded tab once.
    function restorePageTabsAtBoot() {
      var chrome = g.chrome;
      if (!chrome || !chrome.storage || !chrome.storage.local || !chrome.tabs || !chrome.tabs.query) return;
      chrome.storage.local.get(PAGE_TABS_KEY, function (res) {
        noopLastError();
        var rec = res && res[PAGE_TABS_KEY];
        if (!rec || typeof rec !== "object" || !Array.isArray(rec.tabs)) return;
        try { chrome.storage.local.remove(PAGE_TABS_KEY, noopLastError); } catch (e) {
          // A record left behind expires after 30 seconds and is ignored then
        }
        if (typeof rec.at !== "number" || Date.now() - rec.at > 30000) return;
        setTimeout(function () {
          try {
            chrome.tabs.query({}, function (tabs) {
              noopLastError();
              var open = {};
              var byId = {};
              for (var i = 0; tabs && i < tabs.length; i++) {
                var t = tabs[i];
                if (!t || t.id == null) continue;
                byId[t.id] = t;
                if (typeof t.url === "string") open[t.url] = true;
              }
              for (var p = 0; p < rec.tabs.length; p++) {
                var page = rec.tabs[p];
                if (!page || typeof page.url !== "string" || !ownPageUrl(page.url)) continue;
                var kept = byId[page.tabId];
                // A tab that is still there and shows something else moved on.
                if (kept) {
                  if (kept.url === page.url) {
                    try { chrome.tabs.reload(page.tabId, {bypassCache: true}, noopLastError); } catch (e) {
                      // A tab closed since the query has nothing to reload
                    }
                  }
                  continue;
                }
                if (open[page.url] || !chrome.tabs.create) continue;
                open[page.url] = true;
                reopenPageTab(page);
              }
            });
          } catch (e) {
            // A refused tabs query leaves the own pages closed after the restart
          }
        }, 500);
      });
    }

    // A page the build ships as written has no dev client to refresh it, so
    // the open tabs that show it are reloaded from here.
    function reloadStandalonePages(files) {
      var chrome = g.chrome;
      if (!Array.isArray(files) || !files.length || !chrome || !chrome.tabs || !chrome.tabs.query || !chrome.tabs.reload) return;
      var wanted = {};
      for (var i = 0; i < files.length; i++) {
        if (typeof files[i] !== "string") continue;
        try { wanted[String(chrome.runtime.getURL(scriptFileName(files[i])))] = true; } catch (e) {
          // An unreadable URL for this file matches no open tab to reload
        }
      }
      try {
        chrome.tabs.query({}, function (tabs) {
          noopLastError();
          for (var t = 0; tabs && t < tabs.length; t++) {
            var tab = tabs[t];
            if (!tab || tab.id == null || typeof tab.url !== "string") continue;
            if (!wanted[tab.url.replace(/[?#].*$/, "")]) continue;
            try { chrome.tabs.reload(tab.id, {bypassCache: true}, noopLastError); } catch (e) {
              // A tab closed since the query has nothing to reload
            }
          }
        });
      } catch (e) {
        // No tabs API in this background means no standalone tab to reload
      }
    }

    // Dev-loop reload without the CDP controller: content-scripts reload the
    // matching tabs at the new bundle, or re-inject in place where no registry
    // exists; service-worker/full/manifest restart the extension.
    function performDevReload(type, onDone, frame) {
      var chrome = g.chrome;
      if (!chrome) return;

      var fullReload = function () {
        // restartExtension flags the next generation's heal before it reloads.
        // Deferred so in-flight frames and the tab console announcement flush
        // before the SW dies; the devtools companion confirms completion.
        restartExtension(150);
      };

      var reloadInstead = function () {
        fullReload();
        if (onDone) { try { onDone(); } catch (e) {
          // A throw in the caller's callback must not undo the started restart
        } }
      };

      if (type === "content-scripts" && chrome.scripting && chrome.tabs && chrome.tabs.query) {
        var dev = devContentScripts();
        if (dev && typeof dev.reload === "function") {
          try {
            dev.reload(frame && frame.changedContentScriptEntries, function (handled) {
              if (handled) { if (onDone) { try { onDone(); } catch (e) {
                // A throw in the caller's callback must not undo the finished reload
              } } return; }
              if (reinjectContentScripts(onDone, undefined, reloadInstead)) return;
              fullReload();
            });
            return;
          } catch (e) {
            // A throwing dev runtime falls back to the manifest-based reinject
          }
        }
        if (reinjectContentScripts(onDone, undefined, reloadInstead)) return;
      }

      fullReload();
    }

    // One server-built label travels the ReloadFrame; the announcement
    // fires HERE, next to the actual reload action, so it stays true.

    // console.log the reload line into every open injectable tab; the patched
    // ISOLATED-world console also lands it in the dev-server log stream.
    function announceReloadInTabs(text) {
      var chrome = g.chrome;
      if (!chrome || !chrome.tabs || !chrome.tabs.query) return;
      try {
        chrome.tabs.query({}, function (tabs) {
          noopLastError();
          if (!tabs) return;
          for (var i = 0; i < tabs.length; i++) {
            (function (tab) {
              if (!tab || tab.id == null || !isInjectableUrl(tab.url)) return;
              if (chrome.scripting && chrome.scripting.executeScript) {
                try {
                  chrome.scripting.executeScript(
                    {target: {tabId: tab.id}, func: function (t) { console.log(t); }, args: [text]},
                    noopLastError
                  );
                  return;
                } catch (e) {
                  // A tab that refuses scripting falls back to the MV2 executeScript
                }
              }
              // MV2 fallback (Firefox without the scripting API).
              if (chrome.tabs.executeScript) {
                try {
                  chrome.tabs.executeScript(tab.id, {code: "console.log(" + JSON.stringify(text) + ");"}, noopLastError);
                } catch (e) {
                  // A tab that refuses scripts only misses the reload console line
                }
              }
            })(tabs[i]);
          }
        });
      } catch (e) {
        // No tabs API means no tab console to announce the reload in
      }
    }

    // The scripts-replay shim (plugin-reload) keeps the SW's own
    // executeScript registry; the replay is fire-and-forget by design.
    // The answer is the number of open tabs a changed file ran in again.
    function replayProgrammaticScripts(changedScriptFiles, done) {
      var answer = function (outcomes) {
        var tabs = {};
        var count = 0;
        for (var i = 0; Array.isArray(outcomes) && i < outcomes.length; i++) {
          var one = outcomes[i];
          if (!one || !one.ok || tabs[one.tabId]) continue;
          tabs[one.tabId] = true;
          count++;
        }
        if (done) done(count);
      };
      if (!Array.isArray(changedScriptFiles) || changedScriptFiles.length === 0) return answer();
      var replay = g.__extjsScriptsReplay;
      if (typeof replay !== "function") return answer();
      try {
        var outcome = replay(changedScriptFiles);
        if (outcome && typeof outcome.then === "function") {
          outcome.then(answer, function () { answer(); });
        } else answer();
      // A throwing replay shim counts as zero tabs replayed for the receipt
      } catch (e) { answer(); }
    }

    // The receipt of a reload that reloads nothing itself waits a moment
    // for its replay, so it can say how many tabs ran the file again.
    var REPLAY_RECEIPT_WAIT_MS = 500;
    var sendHeldReloadAck = null;

    // The browser reads a file named in scripting.registerContentScripts when
    // the script is registered, so an edit reaches no page until it reads again.
    var REGISTERED_RELOAD_KEY = "__extjsDevRegisteredReload";

    function scriptFileName(value) {
      return String(value || "").replace(/^[/]+/, "");
    }

    // Gecko reads a registered file once per address and keeps that copy
    // through an update and a tab reload. A new address is read from disk.
    var SCRIPT_ADDRESS_QUERY = "?extjs-dev=";
    var SCRIPT_VERSIONS_KEY = "__extjsDevScriptVersions";
    var scriptVersions = null;
    var scriptVersionWaiters = [];
    var scriptVersionCount = 0;
    var wrappedRegistries = [];
    var nativeRegistry = null;
    var registryCalls = 0;
    // An entry no registration has, so the browser refuses a call that
    // names it and changes nothing.
    var SHAPE_REFUSED = {id: "_extjs-dev-shape", js: ["extjs-dev-shape.js"], matches: ["*://extjs.invalid/*"]};
    var registryCalledAt = 0;

    function plainScriptAddress(value) {
      var name = String(value || "");
      var at = name.indexOf(SCRIPT_ADDRESS_QUERY);
      return at === -1 ? name : name.slice(0, at);
    }

    // A name that carries its own query or fragment is the author's address.
    function scriptAddress(value) {
      var plain = plainScriptAddress(value);
      if (plain.indexOf("?") !== -1 || plain.indexOf("#") !== -1) return plain;
      var version = scriptVersions ? scriptVersions[scriptFileName(plain)] : null;
      return typeof version === "string" ? plain + SCRIPT_ADDRESS_QUERY + version : plain;
    }

    function withFileNames(scripts, rename) {
      if (!Array.isArray(scripts)) return scripts;
      var renamed = function (files) {
        var out = [];
        for (var f = 0; f < files.length; f++) out.push(typeof files[f] === "string" ? rename(files[f]) : files[f]);
        return out;
      };
      var list = [];
      for (var i = 0; i < scripts.length; i++) {
        var script = scripts[i];
        if (!script || typeof script !== "object") { list.push(script); continue; }
        var copy = {};
        for (var key in script) {
          if (Object.prototype.hasOwnProperty.call(script, key)) copy[key] = script[key];
        }
        if (Array.isArray(script.js)) copy.js = renamed(script.js);
        if (Array.isArray(script.css)) copy.css = renamed(script.css);
        list.push(copy);
      }
      return list;
    }

    // Session storage outlives a suspended background and is emptied by an
    // extension reload, which is when every address is read again anyway.
    function withScriptVersions(cb) {
      if (scriptVersions) return cb();
      scriptVersionWaiters.push(cb);
      if (scriptVersionWaiters.length > 1) return;
      var done = function (map) {
        if (!scriptVersions) scriptVersions = map && typeof map === "object" ? map : {};
        var fns = scriptVersionWaiters;
        scriptVersionWaiters = [];
        for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) {
          // One waiter that throws must not keep the others from running
        } }
      };
      try { setTimeout(function () { done(null); }, 1000); } catch (e) {
        // Without a guard timer the session read still answers the waiters
      }
      try {
        g.chrome.storage.session.get(SCRIPT_VERSIONS_KEY, function (res) {
          noopLastError();
          done(res && res[SCRIPT_VERSIONS_KEY]);
        });
      // No session storage starts with no versions, every address plain
      } catch (e) { done(null); }
    }

    // The author's calls keep the names they wrote: a write takes the current
    // address of each file, and a read gives the plain names back.
    function wrapScriptRegistry(scripting) {
      if (!scripting || wrappedRegistries.indexOf(scripting) !== -1) return;
      if (typeof scripting.registerContentScripts !== "function" || typeof scripting.updateContentScripts !== "function") return;
      wrappedRegistries.push(scripting);
      var natives = {};
      // One namespace of an engine can answer a callback and hand nothing
      // back, so a single read tells which of the two forms this one has.
      var style = null;
      var answersCallback = function () {
        if (style === null) {
          var read;
          // A read that throws is treated as the promise form of the API
          try { read = natives.getRegisteredContentScripts(); } catch (e) { style = false; return style; }
          style = !(read && typeof read.then === "function");
          if (!style) read.then(function () {}, function () {});
        }
        return style;
      };
      var wrapWrite = function (method, addresses) {
        if (typeof scripting[method] !== "function") return;
        var native = scripting[method].bind(scripting);
        natives[method] = native;
        scripting[method] = function () {
          var args = [].slice.call(arguments);
          var last = args.length - 1;
          var done = last >= 0 && typeof args[last] === "function" ? args[last] : null;
          registryCalls++;
          registryCalledAt = Date.now();
          var settled = false;
          var settle = function () {
            if (settled) return;
            settled = true;
            registryCalls--;
            registryCalledAt = Date.now();
          };
          var call = function () {
            if (addresses) args[0] = withFileNames(args[0], scriptAddress);
            if (done) args[last] = function () { settle(); return done.apply(this, arguments); };
            // The error is left unread, so the browser still names it.
            else if (answersCallback()) args.push(function () { settle(); });
            var ret = native.apply(null, args);
            if (done) return ret;
            if (ret && typeof ret.then === "function") ret.then(settle, settle);
            else if (!answersCallback()) settle();
            return ret;
          };
          if (!addresses || scriptVersions || !Array.isArray(args[0])) {
            try { return call(); } catch (e) { settle(); throw e; }
          }
          // The browser checks the shape of a call as it is made. The same
          // call with an entry it refuses later throws that check here.
          try {
            var refusal = method === "registerContentScripts" ? [SHAPE_REFUSED, SHAPE_REFUSED] : [{id: SHAPE_REFUSED.id}];
            var probe = [args[0].concat(refusal)];
            if (done || answersCallback()) probe.push(noopLastError);
            var refused;
            try { refused = native.apply(null, probe); } catch (e) {
              if (!done) throw e;
              probe.pop();
              refused = native.apply(null, probe);
            }
            if (refused && typeof refused.then === "function") refused.then(function () {}, function () {});
          } catch (e) { settle(); throw e; }
          // A call that hands nothing back is answered the same way here.
          if (done || answersCallback()) {
            // The shape probe already threw any refusal, settle frees the count
            withScriptVersions(function () { try { call(); } catch (e) { settle(); } });
            return undefined;
          }
          return new Promise(function (resolve, reject) {
            // The caller's promise rejects with the same error the call threw
            withScriptVersions(function () { try { resolve(call()); } catch (e) { settle(); reject(e); } });
          });
        };
      };
      if (typeof scripting.getRegisteredContentScripts !== "function") style = false;
      else natives.getRegisteredContentScripts = scripting.getRegisteredContentScripts.bind(scripting);
      wrapWrite("registerContentScripts", true);
      wrapWrite("updateContentScripts", true);
      wrapWrite("unregisterContentScripts", false);
      if (typeof scripting.getRegisteredContentScripts === "function") {
        var nativeRead = natives.getRegisteredContentScripts;
        var plain = function (list) { return withFileNames(list, plainScriptAddress); };
        scripting.getRegisteredContentScripts = function () {
          var args = [].slice.call(arguments);
          var last = args.length - 1;
          if (last >= 0 && typeof args[last] === "function") {
            var done = args[last];
            args[last] = function (list) { return done.call(this, plain(list)); };
            return nativeRead.apply(null, args);
          }
          var ret = nativeRead.apply(null, args);
          return ret && typeof ret.then === "function" ? ret.then(plain) : ret;
        };
      }
      wrapInjection(scripting, answersCallback);
      if (!nativeRegistry) nativeRegistry = natives;
    }

    // Gecko runs the copy of an injected file it read first at an address,
    // so a file edited since is named at its current one, as a registration is.
    function wrapInjection(scripting, answersCallback) {
      if (typeof scripting.executeScript !== "function") return;
      var native = scripting.executeScript.bind(scripting);
      scripting.executeScript = function (injection) {
        var args = [].slice.call(arguments);
        var last = args.length - 1;
        var done = last > 0 && typeof args[last] === "function";
        var target = injection && typeof injection === "object" ? injection.target : null;
        if (!target || typeof target !== "object" || !Array.isArray(injection.files)) return native.apply(null, args);
        var call = function () {
          var copy = {};
          for (var key in injection) {
            if (Object.prototype.hasOwnProperty.call(injection, key)) copy[key] = injection[key];
          }
          copy.files = [];
          for (var f = 0; f < injection.files.length; f++) {
            copy.files.push(typeof injection.files[f] === "string" ? scriptAddress(injection.files[f]) : injection.files[f]);
          }
          args[0] = copy;
          return native.apply(null, args);
        };
        if (scriptVersions) return call();
        if (typeof target.tabId !== "number") return native.apply(null, args);
        // The browser checks the shape of a call as it is made. The same
        // call on a tab that cannot exist throws that check here.
        var probe = args.slice();
        var nowhere = {};
        for (var name in target) {
          if (Object.prototype.hasOwnProperty.call(target, name)) nowhere[name] = target[name];
        }
        nowhere.tabId = -1;
        probe[0] = {};
        for (var field in injection) {
          if (Object.prototype.hasOwnProperty.call(injection, field)) probe[0][field] = injection[field];
        }
        probe[0].target = nowhere;
        var unanswered = !done && answersCallback();
        if (done) probe[last] = noopLastError;
        else if (unanswered) probe.push(noopLastError);
        var refused = native.apply(null, probe);
        if (refused && typeof refused.then === "function") refused.then(function () {}, function () {});
        if (done || unanswered) {
          withScriptVersions(function () { try { call(); } catch (e) {
            // The shape probe already threw any refusal the caller would see
          } });
          return undefined;
        }
        return new Promise(function (resolve, reject) {
          // The caller's promise rejects with the same error the call threw
          withScriptVersions(function () { try { resolve(call()); } catch (e) { reject(e); } });
        });
      };
    }

    function canAddressRegisteredScripts() {
      var chrome = g.chrome;
      return !!(
        engineName() === "firefox" && nativeRegistry && nativeRegistry.updateContentScripts &&
        chrome && chrome.storage && chrome.storage.session && chrome.storage.session.get && chrome.storage.session.set
      );
    }

    // Installed before the background's own code runs, so its first call
    // already goes through here.
    function installScriptAddresses() {
      var chrome = g.chrome;
      if (engineName() !== "firefox" || !chrome || !chrome.storage || !chrome.storage.session || !chrome.storage.session.get) return;
      var roots = [g.chrome, g.browser];
      for (var i = 0; i < roots.length; i++) {
        try { wrapScriptRegistry(roots[i] && roots[i].scripting); } catch (e) {
          // A namespace that refuses wrapping keeps the browser's own calls
        }
      }
      if (nativeRegistry) withScriptVersions(function () {});
    }

    // The first page of a session waits for the registrations a background
    // makes as it starts, so its boot is watched from the first line.
    var BOOT_IDLE_CHECK_MS = 25;
    var BOOT_EVENTS_GRACE_MS = 250;
    var BOOT_GIVE_UP_MS = 4000;
    var BOOT_LATE_WINDOW_MS = 15000;

    function watchBootRegistrations() {
      if (g.__extjsDevBootRegisters !== true) return;
      var bootedAt = Date.now();
      var inFlight = 0;
      var calls = 0;
      var landed = false;
      var reported = false;
      var lateSaid = false;
      var counted = [];
      var failed = function () {
        // A throwing lastError read counts as a call that answered fine
        try { return !!(g.chrome && g.chrome.runtime && g.chrome.runtime.lastError); } catch (e) { return false; }
      };
      var devId = function (entry) {
        var id = entry && typeof entry === "object" ? entry.id : entry;
        return typeof id === "string" && id.indexOf("extjs-dev-cs-") === 0;
      };
      // The dev build registers the manifest's own scripts through the same
      // calls, and those are not the author's registrations.
      var ownCall = function (first) {
        var list = Array.isArray(first) ? first : first && Array.isArray(first.ids) ? first.ids : null;
        if (!list || !list.length) return false;
        for (var i = 0; i < list.length; i++) if (!devId(list[i])) return false;
        return true;
      };
      // A registration that answers after the page was let go is on no open
      // page, which the author is told once.
      var land = function () {
        landed = true;
        if (!reported || lateSaid || Date.now() - bootedAt > BOOT_LATE_WINDOW_MS) return;
        lateSaid = true;
        send({type: "boot-registrations", late: true, afterMs: Date.now() - bootedAt});
      };
      // Any call the boot code is waiting on can be the one a registration
      // follows, so each is counted until the browser answers it.
      var count = function (owner, key, registry, method) {
        var inner = owner[key];
        if (typeof inner !== "function" || inner.__extjsBootCounted) return;
        var wrapper = function () {
          var args = [].slice.call(arguments);
          var self = method ? this : owner;
          if (registry && ownCall(args[0])) return inner.apply(self, args);
          var last = args.length - 1;
          var done = last >= 0 && typeof args[last] === "function" ? args[last] : null;
          var settled = false;
          var settle = function (ok) {
            if (settled) return;
            settled = true;
            inFlight--;
            if (ok && registry === "write") land();
          };
          inFlight++;
          if (registry) calls++;
          if (done) args[last] = function () { settle(!failed()); return done.apply(this, arguments); };
          var ret;
          try { ret = inner.apply(self, args); } catch (e) { settle(false); throw e; }
          if (done) return ret;
          if (!ret || typeof ret.then !== "function") { settle(true); return ret; }
          // The caller gets the same outcome, so a rejection it ignores is
          // still reported as unhandled.
          return ret.then(function (value) { settle(true); return value; }, function (error) { settle(false); throw error; });
        };
        wrapper.__extjsBootCounted = true;
        try {
          owner[key] = wrapper;
          if (owner[key] === wrapper) counted.push({owner: owner, key: key, inner: inner, wrapper: wrapper, kept: !!registry});
        } catch (e) {
          // A frozen method stays unwrapped and is simply not waited on
        }
      };
      var walk = function (owner, depth, seen) {
        var keys = [];
        try { keys = Object.keys(owner); } catch (e) {
          // An object whose keys cannot be read has nothing to walk into
        }
        for (var i = 0; i < keys.length; i++) {
          var value;
          // A getter that throws is skipped, it holds nothing to count
          try { value = owner[keys[i]]; } catch (e) { continue; }
          if (typeof value === "function") { count(owner, keys[i], null); continue; }
          if (!value || typeof value !== "object" || depth >= 3 || seen.indexOf(value) !== -1) continue;
          // An event has listeners, not answers.
          if (typeof value.addListener === "function") continue;
          seen.push(value);
          walk(value, depth + 1, seen);
        }
      };
      // A registration a profile kept from an earlier session is already
      // there for the first page, whatever the background does next.
      var readKept = function (scripting) {
        if (typeof scripting.getRegisteredContentScripts !== "function") return;
        inFlight++;
        var answered = false;
        var answer = function (list) {
          if (answered) return;
          answered = true;
          inFlight--;
          for (var i = 0; list && i < list.length; i++) {
            if (list[i] && typeof list[i].id === "string" && !devId(list[i])) landed = true;
          }
        };
        try {
          var ret = scripting.getRegisteredContentScripts(function (list) { noopLastError(); answer(list); });
          if (ret && typeof ret.then === "function") ret.then(answer, function () { answer(null); });
        // A refused read counts as no kept registration from the profile
        } catch (e) { answer(null); }
      };
      var roots = [g.chrome, g.browser];
      var seen = [];
      var read = false;
      for (var r = 0; r < roots.length; r++) {
        var root = roots[r];
        if (!root || seen.indexOf(root) !== -1) continue;
        seen.push(root);
        var scripting = null;
        try { scripting = root.scripting; } catch (e) {
          // A namespace that throws on access has no registry to count
        }
        if (scripting && seen.indexOf(scripting) === -1) {
          if (!read) { read = true; readKept(scripting); }
          count(scripting, "registerContentScripts", "write");
          count(scripting, "updateContentScripts", "write");
          count(scripting, "unregisterContentScripts", "call");
          count(scripting, "getRegisteredContentScripts", "call");
        }
        walk(root, 1, seen);
      }
      if (typeof g.fetch === "function") count(g, "fetch", null);
      // A response is read after it arrived, and the read is waited on too.
      var body = g.Response && g.Response.prototype;
      var reads = ["json", "text", "arrayBuffer", "blob", "formData"];
      for (var b = 0; body && b < reads.length; b++) count(body, reads[b], null, true);

      // Once it has reported, the background runs on the browser's own calls
      // again. The registry stays counted for a late registration.
      var release = function () {
        for (var i = 0; i < counted.length; i++) {
          var c = counted[i];
          if (c.kept) continue;
          try { if (c.owner[c.key] === c.wrapper) c.owner[c.key] = c.inner; } catch (e) {
            // A frozen method keeps the wrapper, which only passes calls through
          }
        }
      };

      // The browser hands a starting background its install events right
      // after its top level ran, and their listeners are boot code too.
      var eventsDone = false;
      var eventsDue = function () { eventsDone = true; };
      var worker = null;
      try { worker = g.serviceWorker && typeof g.serviceWorker.state === "string" ? g.serviceWorker : null; } catch (e) {
        // An unreadable worker global is treated as a page background
      }
      var doc = null;
      try { doc = g.document && typeof g.document.readyState === "string" ? g.document : null; } catch (e) {
        // An unreadable document is treated as a worker background
      }
      if (worker && worker.state !== "activated" && typeof g.addEventListener === "function") {
        // An installing worker gets onInstalled before it activates.
        g.addEventListener("activate", function () { setTimeout(eventsDue, 0); });
        setTimeout(eventsDue, 1000);
      } else if (!worker && doc && g.chrome && g.chrome.runtime && g.chrome.runtime.onInstalled) {
        // Gecko fires onInstalled a moment after the page loaded, and not at
        // all for a background it only woke.
        var afterLoad = function () { setTimeout(eventsDue, BOOT_EVENTS_GRACE_MS); };
        g.chrome.runtime.onInstalled.addListener(function () { setTimeout(eventsDue, 0); });
        if (doc.readyState === "complete" || typeof g.addEventListener !== "function") afterLoad();
        else g.addEventListener("load", afterLoad);
      } else {
        setTimeout(eventsDue, worker ? 0 : BOOT_EVENTS_GRACE_MS);
      }

      var idleOnce = false;
      var check = function () {
        if (reported) return;
        var gaveUp = Date.now() - bootedAt >= BOOT_GIVE_UP_MS;
        var idle = eventsDone && inFlight <= 0;
        if ((idle && idleOnce) || gaveUp) {
          reported = true;
          release();
          var frame = {type: "boot-registrations", calls: calls, landed: landed};
          if (!(idle && idleOnce)) { frame.pending = true; lateSaid = true; }
          send(frame);
          return;
        }
        idleOnce = idle;
        try { setTimeout(check, BOOT_IDLE_CHECK_MS); } catch (e) {
          // A live background always has setTimeout, this only shields the poll
        }
      };
      setTimeout(check, 0);
    }

    // Every changed file gets a new address, registered now or later.
    function moveScriptAddresses(changedScriptFiles, cb) {
      withScriptVersions(function () {
        var version = Date.now().toString(36) + "-" + (scriptVersionCount++).toString(36);
        for (var i = 0; i < changedScriptFiles.length; i++) {
          var name = typeof changedScriptFiles[i] === "string" ? scriptFileName(changedScriptFiles[i]) : "";
          // A hot update file has a new name on every edit and is never registered.
          if (name && name.indexOf("hot/") !== 0) scriptVersions[name] = version;
        }
        var rec = {};
        rec[SCRIPT_VERSIONS_KEY] = scriptVersions;
        try { g.chrome.storage.session.set(rec, noopLastError); } catch (e) {
          // An unsaved version map only lasts until this background suspends
        }
        cb();
      });
    }

    // A background started for this edit may be between its own unregister
    // and register calls, and a read in that gap finds no registration.
    function whenRegistryQuiet(cb) {
      var waited = 0;
      // A loaded machine answers a call seconds late, and a read made
      // before that answer finds the gap and reloads no tab.
      var check = function () {
        if (waited >= 15000 || (registryCalls <= 0 && Date.now() - registryCalledAt >= 300)) return cb();
        waited += 100;
        // Without a timer the refresh goes ahead without waiting for quiet
        try { setTimeout(check, 100); } catch (e) { cb(); }
      };
      check();
    }

    function registrationsNaming(existing, changedScriptFiles) {
      var changed = {};
      for (var c = 0; c < changedScriptFiles.length; c++) changed[scriptFileName(changedScriptFiles[c])] = true;
      var out = [];
      for (var i = 0; existing && i < existing.length; i++) {
        var s = existing[i];
        if (!s || typeof s.id !== "string" || s.id.indexOf("extjs-dev-cs-") === 0) continue;
        var files = stringList(s.js).concat(stringList(s.css));
        for (var f = 0; f < files.length; f++) {
          if (changed[scriptFileName(plainScriptAddress(files[f]))]) { out.push(s); break; }
        }
      }
      return out;
    }

    // The ids of the open tabs the registrations match, excludeMatches honored.
    function tabIdsForRegistrations(scripts, cb) {
      var chrome = g.chrome;
      var ids = {};
      var pending = 1;
      var step = function () {
        pending--;
        if (pending > 0) return;
        var out = [];
        for (var id in ids) out.push(Number(id));
        cb(out);
      };
      var query = function (patterns, each) {
        if (!patterns.length || !chrome.tabs || !chrome.tabs.query) return each([]);
        try {
          chrome.tabs.query({url: patterns}, function (tabs) { noopLastError(); each(tabs || []); });
        // A refused tabs query matches no tab for these patterns
        } catch (e) { each([]); }
      };
      for (var i = 0; i < scripts.length; i++) {
        (function (script) {
          pending++;
          query(stringList(script.excludeMatches), function (excludedTabs) {
            var excluded = {};
            for (var x = 0; x < excludedTabs.length; x++) {
              if (excludedTabs[x] && excludedTabs[x].id != null) excluded[excludedTabs[x].id] = true;
            }
            query(stringList(script.matches), function (tabs) {
              for (var t = 0; t < tabs.length; t++) {
                var tab = tabs[t];
                if (!tab || tab.id == null || excluded[tab.id] || !isInjectableUrl(tab.url)) continue;
                ids[tab.id] = true;
              }
              step();
            });
          });
        })(scripts[i]);
      }
      step();
    }

    function reloadTabIds(tabIds) {
      var chrome = g.chrome;
      if (!chrome.tabs || !chrome.tabs.reload) return;
      for (var i = 0; i < tabIds.length; i++) {
        try { chrome.tabs.reload(tabIds[i], {}, noopLastError); } catch (e) {
          // A tab closed since the query has nothing to reload
        }
      }
    }

    // The update names each file at its current address, in the browser's
    // own call so nothing between here and it reads the names another way.
    function moveRegisteredScripts(scripts, cb) {
      var updates = [];
      for (var i = 0; i < scripts.length; i++) {
        var update = {id: scripts[i].id};
        if (stringList(scripts[i].js).length) update.js = stringList(scripts[i].js);
        if (stringList(scripts[i].css).length) update.css = stringList(scripts[i].css);
        updates.push(update);
      }
      try {
        nativeRegistry.updateContentScripts(withFileNames(updates, scriptAddress), function () {
          var failed = false;
          try { failed = !!g.chrome.runtime.lastError; } catch (e) {
            // A throwing lastError read counts as an update that landed
          }
          cb(!failed);
        });
      // A refused update falls back to restarting the extension
      } catch (e) { cb(false); }
    }

    function restartForRegisteredScripts(scripts, tabIds) {
      var scriptIds = [];
      for (var i = 0; i < scripts.length; i++) scriptIds.push(scripts[i].id);
      try {
        var rec = {};
        rec[REGISTERED_RELOAD_KEY] = {at: Date.now(), tabs: tabIds, scripts: scriptIds};
        g.chrome.storage.local.set(rec, noopLastError);
      } catch (e) {
        // An unsaved record only skips the tab reload after the restart
      }
      if (sendHeldReloadAck) sendHeldReloadAck();
      restartExtension(150);
    }

    // Answers true when the extension restarts for the edit. Chromium reads the
    // files again on an update, Gecko reads them again at a new address.
    function refreshRegisteredScripts(changedScriptFiles, cb, moved) {
      var chrome = g.chrome;
      var answered = false;
      var guard = null;
      var answer = function (restarting) {
        if (answered) return;
        answered = true;
        if (guard) { try { clearTimeout(guard); } catch (e) {
          // A guard timer that cannot be cleared only finds the answer given
        } }
        try { cb(restarting); } catch (e) {
          // A throw in the caller's callback must not stop the reload
        }
      };
      if (
        !Array.isArray(changedScriptFiles) || !changedScriptFiles.length ||
        !chrome || !chrome.scripting || !chrome.scripting.getRegisteredContentScripts
      ) return answer(false);
      var addressed = canAddressRegisteredScripts();
      var refresh = function () {
        try { guard = setTimeout(function () { answer(false); }, 1000); } catch (e) {
          // Without a guard timer the registry read still answers the call
        }
        // The update below is the browser's own call, so the read is too: a
        // wrapped read answers the names the author wrote, not the files run.
        var read = addressed && nativeRegistry.getRegisteredContentScripts
          ? nativeRegistry.getRegisteredContentScripts
          : function (done) { return chrome.scripting.getRegisteredContentScripts(done); };
        try {
          read(function (existing) {
            noopLastError();
            // The files already have their new address, so a slow answer
            // still moves the registrations and reloads their tabs.
            if (answered && !addressed) return;
            var scripts = registrationsNaming(existing, changedScriptFiles);
            if (!scripts.length) return answer(false);
            tabIdsForRegistrations(scripts, function (tabIds) {
              if (addressed) {
                return moveRegisteredScripts(scripts, function (moved) {
                  if (moved) { reloadTabIds(tabIds); return answer(false); }
                  if (answered) return;
                  restartForRegisteredScripts(scripts, tabIds);
                  answer(true);
                });
              }
              if (answered) return;
              if (engineName() === "firefox") {
                restartForRegisteredScripts(scripts, tabIds);
                return answer(true);
              }
              var updates = [];
              for (var u = 0; u < scripts.length; u++) {
                var update = {id: scripts[u].id};
                if (stringList(scripts[u].js).length) update.js = stringList(scripts[u].js);
                if (stringList(scripts[u].css).length) update.css = stringList(scripts[u].css);
                updates.push(update);
              }
              var finish = function () { noopLastError(); reloadTabIds(tabIds); answer(false); };
              if (!chrome.scripting.updateContentScripts) return finish();
              // A refused update still reloads the tabs at the files they hold
              try { chrome.scripting.updateContentScripts(updates, finish); } catch (e) { finish(); }
            });
          });
        // A refused registry read leaves the reload to the frame's own kind
        } catch (e) { answer(false); }
      };
      if (!addressed) return refresh();
      if (moved) return whenRegistryQuiet(refresh);
      moveScriptAddresses(changedScriptFiles, function () { whenRegistryQuiet(refresh); });
    }

    // The generation after that restart reloads the recorded tabs once two
    // reads in a row show the scripts registered, or a few seconds passed.
    function reloadRegisteredScriptTabsAtBoot() {
      var chrome = g.chrome;
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(REGISTERED_RELOAD_KEY, function (res) {
        noopLastError();
        var rec = res && res[REGISTERED_RELOAD_KEY];
        if (!rec || typeof rec !== "object") return;
        try { chrome.storage.local.remove(REGISTERED_RELOAD_KEY, noopLastError); } catch (e) {
          // A record left behind expires after 30 seconds and is ignored then
        }
        if (typeof rec.at !== "number" || Date.now() - rec.at > 30000 || !Array.isArray(rec.tabs)) return;
        var wanted = stringList(rec.scripts);
        var attempts = 0;
        var settled = 0;
        var check = function () {
          attempts++;
          var proceed = function (existing) {
            var have = {};
            for (var i = 0; existing && i < existing.length; i++) if (existing[i]) have[existing[i].id] = true;
            var missing = false;
            for (var w = 0; w < wanted.length; w++) if (!have[wanted[w]]) missing = true;
            // A background that unregisters before it registers leaves a gap.
            settled = missing ? 0 : settled + 1;
            if (settled < 2 && attempts < 20) return setTimeout(check, 250);
            reloadTabIds(rec.tabs);
          };
          try {
            chrome.scripting.getRegisteredContentScripts(function (existing) { noopLastError(); proceed(existing); });
          // A refused registry read reloads the recorded tabs without waiting
          } catch (e) { reloadTabIds(rec.tabs); }
        };
        setTimeout(check, 250);
      });
    }

    // Gecko keeps a declared content script stylesheet by its address, for
    // open tabs and for later navigations, until the extension reloads.
    var SHEET_OVERRIDES_KEY = "__extjsDevSheetOverrides";
    var SHEET_SESSION_KEY = "__extjsDevSheetSession";
    var SHEET_SIGNAL = "__extjsDevSheets";
    var SHEET_ENTRIES_KEY = "__extjsDevSheetEntries";
    var SHEET_REGISTRATION_PREFIX = "extjs-dev-cs-sheet-";
    var sheetSessionChecked = false;
    var sheetSessionWaiters = [];
    var sheetOverrides = null;

    function sheetAddress(file, digest) {
      return file + "?v=" + String(digest).slice(0, 16);
    }

    // Gecko's getManifest names each content script file by its full address.
    function declaredFileName(value) {
      var name = String(value || "");
      var base = "";
      try { base = String(g.chrome.runtime.getURL("")); } catch (e) {
        // An unreadable base URL leaves the name as the manifest gave it
      }
      if (base && name.indexOf(base) === 0) name = name.slice(base.length);
      return scriptFileName(name);
    }

    function declaredEntries() {
      // No manifest to read means no declared entry to match a sheet to
      try { return g.chrome.runtime.getManifest().content_scripts || []; } catch (e) { return []; }
    }

    function declaredEntriesNaming(file) {
      var out = [];
      var entries = declaredEntries();
      var wanted = scriptFileName(file);
      for (var i = 0; i < entries.length; i++) {
        var css = stringList(entries[i] && entries[i].css);
        for (var c = 0; c < css.length; c++) {
          if (declaredFileName(css[c]) === wanted) { out.push(entries[i]); break; }
        }
      }
      return out;
    }

    // A frame names the bundles the browser ran in it, which is the browser's
    // own answer for matches, excludes, globs, frames and origin fallback.
    function entryRuns(entry, bundles) {
      var js = stringList(entry && entry.js);
      for (var i = 0; i < js.length; i++) {
        if (bundles.indexOf(declaredFileName(js[i])) !== -1) return true;
      }
      return false;
    }

    // Sent in this order and not awaited, so the new address is in the frame
    // before the old copies go. An address already there adds no second copy.
    function swapDeclaredSheet(target, file, previousDigest, digest) {
      var chrome = g.chrome;
      var stale = [file];
      if (previousDigest && previousDigest !== digest) stale.push(sheetAddress(file, previousDigest));
      try { chrome.scripting.insertCSS({target: target, files: [sheetAddress(file, digest)]}, noopLastError); } catch (e) {
        // A frame gone since the query has no sheet to swap in
      }
      for (var i = 0; i < stale.length; i++) {
        try { chrome.scripting.removeCSS({target: target, files: [stale[i]]}, noopLastError); } catch (e) {
          // A frame gone since the query has no stale sheet left to remove
        }
      }
    }

    function canSwapDeclaredSheets() {
      var chrome = g.chrome;
      return !!(
        engineName() === "firefox" && chrome && chrome.scripting && chrome.scripting.insertCSS &&
        chrome.scripting.removeCSS && chrome.scripting.executeScript && chrome.tabs && chrome.tabs.query &&
        chrome.storage && chrome.storage.local && chrome.storage.session
      );
    }

    // A registered sheet at the entry's own run_at lands after the declared
    // copy, so a later document starts on the new rules with no one awake.
    function registerSheetOverrides(overrides) {
      var chrome = g.chrome;
      if (
        !chrome.scripting.registerContentScripts || !chrome.scripting.getRegisteredContentScripts ||
        !chrome.scripting.updateContentScripts || !chrome.scripting.unregisterContentScripts
      ) return;
      var entries = declaredEntries();
      var wanted = [];
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i] || {};
        var matches = stringList(entry.matches);
        // A globbed entry has no registered form, its frames ask one by one.
        if (!matches.length || stringList(entry.include_globs).length || stringList(entry.exclude_globs).length) continue;
        var css = stringList(entry.css);
        var files = [];
        for (var c = 0; c < css.length; c++) {
          var name = declaredFileName(css[c]);
          if (typeof overrides[name] === "string") files.push(sheetAddress(name, overrides[name]));
        }
        if (!files.length) continue;
        wanted.push({
          id: SHEET_REGISTRATION_PREFIX + i,
          matches: matches,
          excludeMatches: stringList(entry.exclude_matches),
          css: files,
          runAt: mapRunAt(entry.run_at),
          allFrames: entry.all_frames === true,
          matchOriginAsFallback: entry.match_origin_as_fallback === true,
          persistAcrossSessions: false
        });
      }
      try {
        chrome.scripting.getRegisteredContentScripts(function (existing) {
          noopLastError();
          var have = {};
          for (var k = 0; existing && k < existing.length; k++) {
            var id = existing[k] && existing[k].id;
            if (typeof id === "string" && id.indexOf(SHEET_REGISTRATION_PREFIX) === 0) have[id] = true;
          }
          var toRegister = [], toUpdate = [], toDrop = [], keep = {};
          for (var j = 0; j < wanted.length; j++) {
            keep[wanted[j].id] = true;
            (have[wanted[j].id] ? toUpdate : toRegister).push(wanted[j]);
          }
          for (var old in have) if (!keep[old]) toDrop.push(old);
          try {
            if (toDrop.length) chrome.scripting.unregisterContentScripts({ids: toDrop}, noopLastError);
            if (toUpdate.length) chrome.scripting.updateContentScripts(toUpdate, noopLastError);
            if (toRegister.length) chrome.scripting.registerContentScripts(toRegister, noopLastError);
          } catch (e) {
            // A refused call keeps the old sheet registrations until a reload
          }
        });
      } catch (e) {
        // A refused registry read leaves later documents on the declared copy
      }
    }

    // The overrides belong to one load of the extension: a reload reads every
    // declared file again, and session storage is what a reload empties.
    function checkSheetSession() {
      var chrome = g.chrome;
      var done = function () {
        sheetSessionChecked = true;
        var fns = sheetSessionWaiters;
        sheetSessionWaiters = [];
        for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) {
          // One waiter that throws must not keep the others from running
        } }
      };
      if (!canSwapDeclaredSheets()) return done();
      try {
        chrome.storage.session.get(SHEET_SESSION_KEY, function (res) {
          noopLastError();
          if (res && res[SHEET_SESSION_KEY]) return done();
          var mark = {};
          mark[SHEET_SESSION_KEY] = Date.now();
          try { chrome.storage.session.set(mark, noopLastError); } catch (e) {
            // An unsaved mark only repeats this reset on the next background start
          }
          sheetOverrides = {};
          try { registerSheetOverrides({}); } catch (e) {
            // Stale sheet registrations stay until the extension reloads again
          }
          // A record that cannot be removed is still reset in memory above
          try { chrome.storage.local.remove(SHEET_OVERRIDES_KEY, function () { noopLastError(); done(); }); } catch (e) { done(); }
        });
      // No session storage leaves the overrides unread, waiters still run
      } catch (e) { done(); }
    }

    function withSheetOverrides(cb) {
      var read = function () {
        if (sheetOverrides) return cb(sheetOverrides);
        try {
          g.chrome.storage.local.get(SHEET_OVERRIDES_KEY, function (res) {
            noopLastError();
            var map = res && res[SHEET_OVERRIDES_KEY];
            sheetOverrides = map && typeof map === "object" ? map : {};
            cb(sheetOverrides);
          });
        // No local storage means no earlier swap to build on
        } catch (e) { cb({}); }
      };
      if (sheetSessionChecked) read(); else sheetSessionWaiters.push(read);
    }

    // Asks every frame of a tab which declared bundles run in it.
    function bundlesByFrame(tabId, cb) {
      try {
        g.chrome.scripting.executeScript({
          target: {tabId: tabId, allFrames: true},
          args: [SHEET_ENTRIES_KEY],
          func: function (key) {
            // A frame whose global cannot be read runs no declared bundle
            try { return Object.keys(globalThis[key] || {}); } catch (e) { return []; }
          }
        }, function (results) { noopLastError(); cb(Array.isArray(results) ? results : []); });
      // A tab that refuses scripts has no frame to swap a sheet in
      } catch (e) { cb([]); }
    }

    function swapInOpenFrames(jobs, previous) {
      var chrome = g.chrome;
      try {
        chrome.tabs.query({}, function (tabs) {
          noopLastError();
          for (var t = 0; tabs && t < tabs.length; t++) {
            (function (tab) {
              if (!tab || tab.id == null || (tab.url && !isInjectableUrl(tab.url))) return;
              bundlesByFrame(tab.id, function (frames) {
                for (var f = 0; f < frames.length; f++) {
                  var frame = frames[f];
                  if (!frame || !Array.isArray(frame.result) || !frame.result.length) continue;
                  var target = {tabId: tab.id, frameIds: [typeof frame.frameId === "number" ? frame.frameId : 0]};
                  for (var j = 0; j < jobs.length; j++) {
                    if (!entryRuns(jobs[j].entry, frame.result)) continue;
                    swapDeclaredSheet(target, jobs[j].file, previous[jobs[j].file], jobs[j].digest);
                  }
                }
              });
            })(tabs[t]);
          }
        });
      } catch (e) {
        // No tabs API leaves open frames on the old sheet until they reload
      }
    }

    // Answers false when only a reload delivers the edit: no API for the swap,
    // or an entry with no script to ask for it again on a later navigation.
    function refreshDeclaredSheets(sheets, cb) {
      var chrome = g.chrome;
      if (!Array.isArray(sheets) || !sheets.length || !canSwapDeclaredSheets()) return cb(false);
      var jobs = [];
      for (var i = 0; i < sheets.length; i++) {
        var sheet = sheets[i];
        if (!sheet || typeof sheet.file !== "string" || typeof sheet.digest !== "string") return cb(false);
        var entries = declaredEntriesNaming(sheet.file);
        for (var e = 0; e < entries.length; e++) {
          if (!stringList(entries[e].js).length) return cb(false);
          jobs.push({file: scriptFileName(sheet.file), digest: sheet.digest, entry: entries[e]});
        }
      }
      if (!jobs.length) return cb(false);
      withSheetOverrides(function (previous) {
        var next = {};
        for (var key in previous) next[key] = previous[key];
        for (var s = 0; s < sheets.length; s++) next[scriptFileName(sheets[s].file)] = sheets[s].digest;
        var rec = {};
        rec[SHEET_OVERRIDES_KEY] = next;
        sheetOverrides = next;
        // Recorded before any frame is asked: one that loads meanwhile either
        // reads the record and asks, or is already there to be asked.
        var apply = function () {
          noopLastError();
          try { registerSheetOverrides(next); } catch (e) {
            // A refused registration leaves later documents to ask for the sheet
          }
          swapInOpenFrames(jobs, previous);
        };
        // An unsaved record still swaps the open frames from memory
        try { chrome.storage.local.set(rec, apply); } catch (e) { apply(); }
        cb(true);
      });
    }

    // A document loaded after a swap starts on the declared copy again, and
    // each bundle in it says so. Only the frame that asked is corrected.
    function correctSheetsFor(sender, signal) {
      if (!sender || !sender.tab || sender.tab.id == null || !canSwapDeclaredSheets()) return;
      if (!signal || typeof signal.file !== "string") return;
      var target = {tabId: sender.tab.id, frameIds: [typeof sender.frameId === "number" ? sender.frameId : 0]};
      var bundles = [scriptFileName(signal.file)];
      withSheetOverrides(function (overrides) {
        var entries = declaredEntries();
        for (var i = 0; i < entries.length; i++) {
          if (!entryRuns(entries[i], bundles)) continue;
          var css = stringList(entries[i].css);
          for (var c = 0; c < css.length; c++) {
            var file = declaredFileName(css[c]);
            if (typeof overrides[file] === "string") swapDeclaredSheet(target, file, null, overrides[file]);
          }
        }
      });
    }

    function handleDevReloadFrame(frame) {
      var kind = frame.reloadType || "full";
      var label = typeof frame.label === "string" ? frame.label : "";
      // The server always builds the label; the kind-derived fallback only
      // covers a malformed frame so the announcement stays truthful.
      var fallback = kind === "content-scripts" ? "content_script"
        : kind === "service-worker" ? "service_worker"
        : "extension";
      var announced = "[Extension.js] Reloading " + (label || fallback) + "…";

      // Receipt for the broker: proves this SW's message pump processed the
      // frame (a socket write proves nothing). Sent FIRST, so a full reload
      // cannot tear the worker down between the receipt and the reload, and
      // the correlation id is echoed so it confirms only this broadcast.
      var ack = {type: "reload-ack", reloadType: kind, label: label};
      if (frame.reloadId) ack.reloadId = frame.reloadId;
      var changedScripts = frame.changedScriptFiles;
      var acked = false;
      var sendAck = function (replayedTabs) {
        if (acked) return;
        acked = true;
        sendHeldReloadAck = null;
        if (typeof replayedTabs === "number" && replayedTabs > 0) ack.replayedTabs = replayedTabs;
        send(ack);
      };
      var replays = kind === "page" && Array.isArray(changedScripts) && changedScripts.length > 0 &&
        typeof g.__extjsScriptsReplay === "function";
      if (replays) {
        if (sendHeldReloadAck) sendHeldReloadAck();
        sendHeldReloadAck = sendAck;
        // Without a timer the receipt goes out at once with no replay count
        try { setTimeout(function () { sendAck(); }, REPLAY_RECEIPT_WAIT_MS); } catch (e) { sendAck(); }
      } else sendAck();

      // The replay names each file at its address, so on Gecko the edited
      // files get their new one before it runs.
      if (Array.isArray(changedScripts) && changedScripts.length && canAddressRegisteredScripts()) {
        return moveScriptAddresses(changedScripts, function () { replayThenRefresh(frame, kind, announced, true, sendAck); });
      }
      replayThenRefresh(frame, kind, announced, false, sendAck);
    }

    function replayThenRefresh(frame, kind, announced, moved, replayed) {
      // A scripts/ bundle edit: re-run the executeScript calls that named it
      // on their recorded tabs, before any reload decision below.
      replayProgrammaticScripts(frame.changedScriptFiles, replayed);

      refreshRegisteredScripts(frame.changedScriptFiles, function (restarting) {
        if (restarting) return;
        // A restart brings every own tab back itself, so only the reloads
        // that keep the extension running reload a standalone page here.
        if (kind !== "full" && kind !== "service-worker") reloadStandalonePages(frame.standalonePages);
        // Notify-only: rspack-dev-server's livereload refreshes the open
        // surface; reloading the extension here would race it.
        if (kind === "page") return;

        announceReloadInTabs(announced);
        if (!Array.isArray(frame.refreshedStylesheets) || !frame.refreshedStylesheets.length) {
          return performDevReload(kind, function () {}, frame);
        }
        // A sheet-only edit: swap it where the browser can, reload otherwise.
        refreshDeclaredSheets(frame.refreshedStylesheets, function (swapped) {
          if (!swapped) restartExtension(150);
        });
      }, moved);
    }

`

// Once per background start: heal open tabs and restore what a restart left.
const RELOAD_BOOT = `    // Dev registrations outlive runtime.reload(), while the new generation's
    // static manifest already names the current files: drop them first, or
    // every navigation from here on runs the content script twice.
    function unregisterDevContentScripts(onDone) {
      var chrome = g.chrome;
      var done = function () { if (onDone) { try { onDone(); } catch (e) {
        // A throw in the caller's callback must not stop the boot heal
      } } };
      try {
        if (
          !chrome.scripting ||
          !chrome.scripting.getRegisteredContentScripts ||
          !chrome.scripting.unregisterContentScripts
        ) return done();
        chrome.scripting.getRegisteredContentScripts(function (existing) {
          try { void chrome.runtime.lastError; } catch (e) {
            // Reading lastError only marks it seen so the browser logs nothing
          }
          var ids = [];
          if (existing) {
            for (var i = 0; i < existing.length; i++) {
              var id = existing[i] && existing[i].id;
              if (typeof id === "string" && id.indexOf("extjs-dev-cs-") === 0) ids.push(id);
            }
          }
          if (!ids.length) return done();
          try {
            chrome.scripting.unregisterContentScripts({ids: ids}, function () { noopLastError(); done(); });
          // A refused unregister still lets the heal run, worst case twice
          } catch (e) { done(); }
        });
      // No registry API means no dev copies to drop before the heal
      } catch (e) { done(); }
    }

    // One heal per producer generation: onInstalled and the pre-reload storage
    // flag can both fire on the same boot, and each would inject once more.
    var bootHealDone = false;
    function healOpenTabsAtBoot() {
      if (bootHealDone) return;
      bootHealDone = true;
      // Firefox injects declared content scripts into open tabs on a reload
      // itself, so a heal there runs every script a second time.
      try { if (engineName() === "firefox") return; } catch (e) {
        // An unknown engine is healed as Chromium, which needs the heal
      }
      setTimeout(function () {
        var dev = devContentScripts();
        if (dev && typeof dev.heal === "function") {
          try { dev.heal(); return; } catch (e) {
            // A throwing dev runtime falls back to the manifest-based heal
          }
        }
        unregisterDevContentScripts(function () {
          try { reinjectContentScripts(undefined, {register: false, completeOnly: true}); } catch (e) {
            // A failed heal leaves open tabs stale until a reload or navigation
          }
        });
      }, 250);
    }

    // Chrome never injects manifest content scripts into already-open tabs, so
    // fire one reinject on onInstalled (which skips idle-stop SW wakes). Not
    // on the first install: the tabs the browser launched with load beside
    // the extension and Chrome injects them itself.
    try {
      var rtBoot = g.chrome;
      if (rtBoot && rtBoot.runtime && rtBoot.runtime.onInstalled) {
        rtBoot.runtime.onInstalled.addListener(function (details) {
          if (details && details.reason === "install") return;
          try { healOpenTabsAtBoot(); } catch (e) {
            // A failed heal leaves open tabs stale until a reload or navigation
          }
        });
      }
    } catch (e) {
      // No onInstalled event leaves the storage flag to trigger the heal
    }

    try { installScriptAddresses(); } catch (e) {
      // Unwrapped registries only mean Gecko reads an edited file late
    }

    try { watchBootRegistrations(); } catch (e) {
      // A failed boot watch must not stop the rest of the background boot
    }

    try { restoreOverrideTabsAtBoot(); } catch (e) {
      // A failed restore leaves override tabs on the browser's stock page
    }

    try { restorePageTabsAtBoot(); } catch (e) {
      // A failed restore leaves the extension's own tabs closed or stale
    }

    try { reloadRegisteredScriptTabsAtBoot(); } catch (e) {
      // A failed boot reload leaves those tabs on the old registered files
    }

    // A failed session check still releases the waiting sheet readers
    try { checkSheetSession(); } catch (e) {
      sheetSessionChecked = true;
    }

    try {
      if (engineName() === "firefox" && g.chrome && g.chrome.runtime && g.chrome.runtime.onMessage) {
        g.chrome.runtime.onMessage.addListener(function (msg, sender) {
          if (msg && msg[SHEET_SIGNAL]) correctSheetsFor(sender, msg[SHEET_SIGNAL]);
        });
      }
    } catch (e) {
      // No message listener leaves new Gecko frames on the declared sheet
    }

    // Chromium 146 fires no onInstalled on runtime.reload() while 151 reports
    // an "update": the pre-reload storage flag (fresh only) covers the former.
    try {
      var stBoot = g.chrome;
      if (stBoot && stBoot.storage && stBoot.storage.local) {
        stBoot.storage.local.get("__extjsDevPendingReinject", function (res) {
          noopLastError();
          var ts = res && res.__extjsDevPendingReinject;
          if (ts == null) return;
          try { stBoot.storage.local.remove("__extjsDevPendingReinject", noopLastError); } catch (e) {
            // A flag left behind expires after 30 seconds and is ignored then
          }
          if (typeof ts !== "number" || Date.now() - ts > 30000) return;
          healOpenTabsAtBoot();
        });
      }
    } catch (e) {
      // No storage read leaves onInstalled as the only heal trigger
    }

`

export const PRODUCER_RELOAD_EXECUTOR: ProducerExecutor = {
  handlers: RELOAD_HANDLERS,
  boot: RELOAD_BOOT
}

// The producer a dev background runs: the control bridge with this executor.
export interface DevProducerOptions
  extends Pick<BuildProducerOptions, 'sessionFromFile' | 'context'> {
  // The session whose control bridge the background dials.
  session: Pick<
    DevSessionCoordinates,
    'controlPort' | 'instanceId' | 'connectableHost'
  >
}

// The host is the one the session's browser dials: loopback on this machine,
// the public host in a container or over a tunnel.
export function buildDevProducerSource(opts: DevProducerOptions): string {
  const {session, ...rest} = opts

  return buildBridgeProducerSource({
    ...rest,
    controlPort: session.controlPort,
    instanceId: session.instanceId,
    host: session.connectableHost.trim() || '127.0.0.1',
    executor: PRODUCER_RELOAD_EXECUTOR
  })
}

// Set by the build on a background whose source names a content script
// registration, so only that background reports when its calls answered.
export const DEV_BOOT_REGISTERS_GLOBAL = '__extjsDevBootRegisters'

// Each declared content script bundle names itself to its frame and, once a
// sheet was swapped, asks the background to correct that frame. Gecko only.
export function buildDeclaredSheetSignalSource(assetName: string): string {
  return `;(function () {
  try {
    var g = (typeof globalThis === "object" && globalThis) ? globalThis : this;
    var chrome = g && g.chrome;
    var FILE = ${JSON.stringify(assetName)};
    if (!chrome || !chrome.runtime || !/^moz-extension:/.test(String(chrome.runtime.getURL("")))) return;
    var running = g.__extjsDevSheetEntries = g.__extjsDevSheetEntries || {};
    if (running[FILE]) return;
    running[FILE] = true;
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get("__extjsDevSheetOverrides", function (res) {
      try {
        void chrome.runtime.lastError;
        var overrides = res && res.__extjsDevSheetOverrides;
        if (!overrides || typeof overrides !== "object") return;
        for (var file in overrides) {
          chrome.runtime.sendMessage({__extjsDevSheets: {file: FILE}}, function () { try { void chrome.runtime.lastError; } catch (e) {
            // Reading lastError marks it seen when no background listens
          } });
          return;
        }
      } catch (e) {
        // A context invalidated by a reload has no background to ask
      }
    });
  } catch (e) {
    // A bundle that fails to signal still runs, only its sheet stays old
  }
})();
`
}
