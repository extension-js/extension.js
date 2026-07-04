export const BRIDGE_PRODUCER_SOURCE = `;(function () {
  try {
    var g = (typeof globalThis === "object" && globalThis) ? globalThis : this;
    if (!g || g.__extjsBridgeProducerInstalled) return;

    var PORT = parseInt("__EXTJS_CONTROL_PORT__", 10);
    var INSTANCE_ID = "__EXTJS_INSTANCE_ID__";
    var CONTEXT = "__EXTJS_CONTEXT__";
    // Connectable host of the dev-server control WS. Baked from the resolved
    // connectable host (loopback locally; the public host for remote/devcontainer).
    var HOST = "__EXTJS_CONTROL_HOST__";
    if (!HOST || HOST.indexOf("__EXTJS") === 0) HOST = "127.0.0.1";
    if (!PORT || PORT < 1) return;

    var WS = g.WebSocket;
    if (typeof WS !== "function") return;

    var consoleRef = g.console || {};
    g.__extjsBridgeProducerInstalled = true;

    // Capture extension event listeners at install time. The producer is
    // prepended to the background bundle, so these wraps run BEFORE user code
    // registers its listeners — letting the bridge replay them on demand. The
    // platform exposes no API to dispatch these events, and CDP attaches too
    // late to wrap addListener, so this is the only path. Replay invokes the
    // handler WITHOUT a user gesture, so the gesture-derived activeTab grant
    // does NOT apply (callers are told gesture:false). This is engine-agnostic:
    // it works on Chromium and Gecko because it only touches addListener.
    //
    // captureEvent transparently wraps addListener/removeListener (delegating to
    // the originals) and records callbacks into the sink array.
    function captureEvent(event, sink) {
      try {
        if (!event || typeof event.addListener !== "function") return;
        var origAdd = event.addListener.bind(event);
        event.addListener = function (cb) {
          if (typeof cb === "function" && sink.indexOf(cb) === -1) sink.push(cb);
          return origAdd(cb);
        };
        if (typeof event.removeListener === "function") {
          var origRemove = event.removeListener.bind(event);
          event.removeListener = function (cb) {
            var i = sink.indexOf(cb);
            if (i !== -1) sink.splice(i, 1);
            return origRemove(cb);
          };
        }
      } catch (e) { /* non-fatal: trigger falls back to its no-listener reply */ }
    }

    // Use g.chrome (not the hoisted chrome var below) — this runs first.
    var actionClickedListeners = [];
    var commandListeners = [];
    if (g.chrome) {
      captureEvent(g.chrome.action && g.chrome.action.onClicked, actionClickedListeners);
      captureEvent(g.chrome.commands && g.chrome.commands.onCommand, commandListeners);
    }

    var LEVELS = ["log", "info", "warn", "error", "debug", "trace"];
    var socket = null;
    var open = false;
    var queue = [];
    var backoff = 250;
    var MAX_BACKOFF = 5000;
    var MAX_QUEUE = 1000;
    var MAX_RESULT_BYTES = 256 * 1024;

    function nowId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function engineName() {
      try {
        return (typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent)) ? "firefox" : "chromium";
      } catch (e) { return "chromium"; }
    }

    // JSON-safe, byte-capped clone of a result value.
    function safeValue(v) {
      try {
        var s = JSON.stringify(v);
        if (s === undefined) return {value: undefined, truncated: false};
        if (s.length > MAX_RESULT_BYTES) {
          return {value: {__type: "truncated", preview: s.slice(0, 1024)}, truncated: true};
        }
        return {value: JSON.parse(s), truncated: false};
      } catch (e) {
        return {value: {__type: "unserializable", preview: String(v).slice(0, 512)}, truncated: false};
      }
    }

    function replyOk(cmdId, value) {
      var s = safeValue(value);
      var frame = {type: "result", cmdId: cmdId, ok: true, value: s.value};
      if (s.truncated) frame.truncated = true;
      try { socket && socket.send(JSON.stringify(frame)); } catch (e) {}
    }

    function replyErr(cmdId, name, message) {
      var frame = {type: "result", cmdId: cmdId, ok: false, error: {name: name, message: String(message), engine: engineName()}};
      try { socket && socket.send(JSON.stringify(frame)); } catch (e) {}
    }

    // Execute one authorized command in the SW (or route to a tab). chrome.*
    // promise APIs are used; callback-only APIs are wrapped.
    function executeCommand(cmd) {
      var op = cmd.op, target = cmd.target || {}, args = cmd.args || {};
      var ctx = target.context || "background";
      var chrome = g.chrome;
      var cmdId = cmd.cmdId;
      try {
        if (!chrome) { replyErr(cmdId, "Unsupported", "chrome.* not available in this context"); return; }
        if (op === "eval") {
          if (ctx === "background") {
            Promise.resolve().then(function () { return (0, eval)(args.expression); })
              .then(function (r) { replyOk(cmdId, r); }, function (e) {
                var msg = (e && e.message) || String(e);
                // MV3 forbids eval of strings in the SW/extension pages; Chrome
                // rejects 'unsafe-eval' in MV3 extension_pages, so this can't be
                // relaxed. Surface it honestly with a usable alternative.
                if (/Content Security Policy|unsafe-eval/i.test(msg)) {
                  replyErr(cmdId, "Unsupported", "eval is blocked in the MV3 service worker by CSP. Use --context page --tab <id> (eval runs in the page's MAIN world), or run on an MV2/Firefox build. Engine: " + engineName());
                } else {
                  replyErr(cmdId, (e && e.name) || "EvalError", msg);
                }
              });
          } else if ((ctx === "content" || ctx === "page") && target.tabId && chrome.scripting) {
            chrome.scripting.executeScript({
              target: {tabId: target.tabId},
              world: ctx === "page" ? "MAIN" : "ISOLATED",
              func: function (src) { return eval(src); },
              args: [String(args.expression)]
            }).then(function (res) { replyOk(cmdId, res && res[0] ? res[0].result : undefined); },
                    function (e) { replyErr(cmdId, "EvalError", e); });
          } else {
            replyErr(cmdId, "Unsupported", "eval in context " + ctx + " requires a tabId");
          }
          return;
        }
        if (op === "storage.get") {
          chrome.storage[args.area || "local"].get(args.key != null ? args.key : null)
            .then(function (r) { replyOk(cmdId, r); }, function (e) { replyErr(cmdId, "StorageError", e); });
          return;
        }
        if (op === "storage.set") {
          chrome.storage[args.area || "local"].set(args.items || {})
            .then(function () { replyOk(cmdId, {set: Object.keys(args.items || {})}); }, function (e) { replyErr(cmdId, "StorageError", e); });
          return;
        }
        if (op === "reload") {
          if (ctx === "background") {
            replyOk(cmdId, {reloading: true});
            setTimeout(function () { try { chrome.runtime.reload(); } catch (e) {} }, 50);
          } else if (target.tabId) {
            chrome.tabs.reload(target.tabId).then(function () { replyOk(cmdId, {reloaded: target.tabId}); }, function (e) { replyErr(cmdId, "ReloadError", e); });
          } else {
            replyErr(cmdId, "Unsupported", "reload needs background or a tabId");
          }
          return;
        }
        if (op === "open") {
          var surface = args.surface || ctx;
          // getPopup is promise-style on Gecko and (MV3) Chromium; fall back to
          // callback-style for older Chromium. Always resolves to a string.
          var getActionPopup = function (cb) {
            try {
              var r = chrome.action && chrome.action.getPopup && chrome.action.getPopup({});
              if (r && typeof r.then === "function") {
                r.then(function (p) { cb(p || ""); }, function () { cb(""); });
                return;
              }
            } catch (e) {}
            try { chrome.action.getPopup({}, function (p) { cb(p || ""); }); }
            catch (e) { cb(""); }
          };
          // Resolve the tab a replayed event should carry: an explicit args.tabId,
          // else the active tab of the focused window.
          var resolveActiveTab = function (a, cb) {
            if (a && typeof a.tabId === "number") {
              try { chrome.tabs.get(a.tabId, function (t) { cb(t || {id: a.tabId}); }); return; }
              catch (e) {}
            }
            try { chrome.tabs.query({active: true, lastFocusedWindow: true}, function (tabs) { cb((tabs && tabs[0]) || undefined); }); }
            catch (e) { cb(undefined); }
          };
          // Replaying a listener carries no user gesture, so activeTab is never
          // granted. Warn when the manifest declares it (handler will diverge
          // from a real click).
          var activeTabWarning = function () {
            try {
              var m = chrome.runtime.getManifest();
              var perms = (m && m.permissions) || [];
              if (perms.indexOf("activeTab") !== -1) {
                return "replayed without a user gesture: activeTab is NOT granted, so APIs that depend on it (scripting on the active tab, captureVisibleTab) behave differently than a real click";
              }
            } catch (e) {}
            return null;
          };
          if (surface === "popup") {
            if (chrome.action && chrome.action.openPopup) {
              chrome.action.openPopup().then(function () { replyOk(cmdId, {opened: "popup"}); }, function (e) { replyErr(cmdId, "Unsupported", "openPopup: " + e); });
            } else { replyErr(cmdId, "Unsupported", "action.openPopup not available"); }
          } else if (surface === "options") {
            try { chrome.runtime.openOptionsPage(function () { replyOk(cmdId, {opened: "options"}); }); }
            catch (e) { replyErr(cmdId, "Unsupported", "openOptionsPage: " + e); }
          } else if (surface === "sidebar") {
            if (chrome.sidePanel && chrome.sidePanel.open && chrome.windows) {
              chrome.windows.getCurrent(function (w) {
                chrome.sidePanel.open({windowId: w.id}).then(function () { replyOk(cmdId, {opened: "sidebar"}); }, function (e) { replyErr(cmdId, "Unsupported", "sidePanel.open: " + e); });
              });
            } else { replyErr(cmdId, "Unsupported", "sidePanel not available (engine: " + engineName() + ")"); }
          } else if (surface === "action") {
            // Trigger the toolbar action. With a default_popup, clicking the icon
            // opens it (reuse openPopup). Without a popup, clicking fires
            // chrome.action.onClicked — we replay the listeners captured at install.
            if (chrome.action) {
              getActionPopup(function (popup) {
                if (popup) {
                  try {
                    chrome.action.openPopup().then(function () { replyOk(cmdId, {triggered: "popup"}); }, function (e) { replyErr(cmdId, "Unsupported", "openPopup: " + e); });
                  } catch (e) { replyErr(cmdId, "Unsupported", "openPopup: " + e); }
                } else if (actionClickedListeners.length) {
                  resolveActiveTab(args, function (tab) {
                    var fired = 0;
                    for (var i = 0; i < actionClickedListeners.length; i++) {
                      try { actionClickedListeners[i](tab); fired++; } catch (e) {}
                    }
                    var reply = {triggered: "onClicked", listeners: fired, gesture: false};
                    var warning = activeTabWarning();
                    if (warning) reply.warning = warning;
                    replyOk(cmdId, reply);
                  });
                } else {
                  replyErr(cmdId, "Unsupported", "action has no popup and no onClicked listener registered");
                }
              });
            } else { replyErr(cmdId, "Unsupported", "chrome.action not available (engine: " + engineName() + ")"); }
          } else if (surface === "command") {
            // Replay a captured chrome.commands.onCommand listener (keyboard
            // shortcut). Same no-gesture caveat as onClicked.
            var commandName = (args && args.name) || undefined;
            if (!commandListeners.length) {
              replyErr(cmdId, "Unsupported", "no chrome.commands.onCommand listener registered");
            } else {
              resolveActiveTab(args, function (tab) {
                var fired = 0;
                for (var i = 0; i < commandListeners.length; i++) {
                  try { commandListeners[i](commandName, tab); fired++; } catch (e) {}
                }
                replyOk(cmdId, {triggered: "command", command: commandName || null, listeners: fired, gesture: false});
              });
            }
          } else { replyErr(cmdId, "BadRequest", "unknown surface: " + surface); }
          return;
        }
        if (op === "tabs.query") {
          chrome.tabs.query(args || {}).then(function (tabs) {
            replyOk(cmdId, (tabs || []).map(function (t) { return {id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId}; }));
          }, function (e) { replyErr(cmdId, "TabsError", e); });
          return;
        }
        if (op === "inspect") {
          // Slice 3 sidecar/default path: extract a DOM snapshot from the target
          // page via chrome.scripting (CDP-free). Closed shadow roots need the
          // --deep-dom CDP escape hatch (separate tool); here we read open ones.
          if ((ctx === "content" || ctx === "page") && target.tabId && chrome.scripting) {
            var maxBytes = (args && args.maxBytes) || 262144;
            var includeHtml = !args || !args.include || args.include.indexOf("html") !== -1;
            chrome.scripting.executeScript({
              target: {tabId: target.tabId},
              world: ctx === "page" ? "MAIN" : "ISOLATED",
              func: function (wantHtml, cap) {
                function countShadow(root) {
                  var n = 0, els = root.querySelectorAll("*");
                  for (var i = 0; i < els.length; i++) { if (els[i].shadowRoot) { n++; n += countShadow(els[i].shadowRoot); } }
                  return n;
                }
                var doc = document;
                var roots = doc.querySelectorAll('#extension-root,[data-extension-root]');
                var out = {
                  url: location.href,
                  title: doc.title,
                  summary: {
                    htmlLength: doc.documentElement.outerHTML.length,
                    scriptCount: doc.querySelectorAll("script").length,
                    styleCount: doc.querySelectorAll("style,link[rel=stylesheet]").length,
                    extensionRootCount: roots.length,
                    openShadowRoots: countShadow(doc),
                    bodyChildCount: doc.body ? doc.body.children.length : 0
                  }
                };
                if (wantHtml) {
                  var html = doc.documentElement.outerHTML;
                  if (cap > 0 && html.length > cap) { out.html = html.slice(0, cap); out.htmlTruncated = true; }
                  else { out.html = html; }
                }
                return out;
              },
              args: [includeHtml, maxBytes]
            }).then(function (res) { replyOk(cmdId, res && res[0] ? res[0].result : undefined); },
                    function (e) { replyErr(cmdId, "InspectError", e); });
          } else if (ctx === "popup" || ctx === "options" || ctx === "sidebar" || ctx === "devtools") {
            // The SW can't read a surface page's DOM; ask the surface's own
            // in-bundle relay (only the open, matching-context page responds).
            chrome.runtime.sendMessage(
              {__extjsInspectRequest: true, target: target, args: args},
              function (resp) {
                if (chrome.runtime.lastError || !resp) {
                  replyErr(cmdId, "Unsupported", "surface '" + ctx + "' is not open (open it first: extension open " + ctx + ")");
                } else if (resp.ok) {
                  replyOk(cmdId, resp.value);
                } else {
                  replyErr(cmdId, (resp.error && resp.error.name) || "InspectError", (resp.error && resp.error.message) || "inspect failed");
                }
              }
            );
          } else if (ctx === "background") {
            replyErr(cmdId, "Unsupported", "the service worker has no DOM; inspect a content/page (with --tab) or an open surface");
          } else {
            replyErr(cmdId, "Unsupported", "inspect of " + ctx + " requires a tabId (content/page) or an open surface");
          }
          return;
        }
        replyErr(cmdId, "BadRequest", "unknown op: " + op);
      } catch (e) {
        replyErr(cmdId, "ExecutorError", e);
      }
    }

    function noopLastError() { try { void g.chrome.runtime.lastError; } catch (e) {} }

    // Only http(s)/file/ftp tabs can run a content script; skip chrome://, the
    // extension's own pages, about:blank, etc.
    function isInjectableUrl(url) {
      return typeof url === "string" && /^(https?|file|ftp):/i.test(url);
    }

    // Re-inject a single declared content-script entry's fresh files into every
    // open tab it matches, in place. The wrapper's reinject runtime tears down
    // the previous mount (matched by data-extjs-reinject-owner + build hash) and
    // mounts the new one — so this is the controller-less equivalent of the CDP
    // controller's reinjection, just driven from inside the extension.
    function reinjectContentScriptEntry(entry) {
      var chrome = g.chrome;
      var matches = (entry && entry.matches) || [];
      if (!Array.isArray(matches) || !matches.length) return;
      var jsFiles = ((entry && entry.js) || []).filter(function (f) { return typeof f === "string"; });
      var cssFiles = ((entry && entry.css) || []).filter(function (f) { return typeof f === "string"; });
      if (!jsFiles.length && !cssFiles.length) return;
      var world = entry.world === "MAIN" ? "MAIN" : "ISOLATED";
      var allFrames = !!entry.all_frames;
      try {
        chrome.tabs.query({url: matches}, function (tabs) {
          var err = null;
          try { err = chrome.runtime.lastError; } catch (e) {}
          if (err || !tabs) return;
          for (var i = 0; i < tabs.length; i++) {
            (function (tab) {
              if (!tab || tab.id == null || !isInjectableUrl(tab.url)) return;
              var target = {tabId: tab.id, allFrames: allFrames};
              if (cssFiles.length && chrome.scripting.insertCSS) {
                try { chrome.scripting.insertCSS({target: target, files: cssFiles}, noopLastError); } catch (e) {}
              }
              if (jsFiles.length && chrome.scripting.executeScript) {
                try {
                  chrome.scripting.executeScript(
                    {target: target, files: jsFiles, world: world, injectImmediately: true},
                    noopLastError
                  );
                } catch (e) {}
              }
            })(tabs[i]);
          }
        });
      } catch (e) {}
    }

    // Re-inject all content scripts into their open tabs. Reads the manifest
    // FROM DISK (not chrome.runtime.getManifest(), which is frozen at extension-
    // registration time) because dev content-script filenames are content-hashed
    // and change on every edit — disk has the new js/css paths.
    function reinjectContentScripts(onDone) {
      var chrome = g.chrome;
      try {
        if (typeof g.fetch !== "function" || !chrome.scripting) return false;
        g.fetch(chrome.runtime.getURL("manifest.json"), {cache: "no-store"})
          .then(function (r) { return r.json(); })
          .then(function (manifest) {
            var entries = (manifest && manifest.content_scripts) || [];
            for (var i = 0; i < entries.length; i++) reinjectContentScriptEntry(entries[i]);
            reregisterForFutureNavigations(entries);
            if (onDone) { try { onDone(); } catch (e) {} }
          })
          .catch(function () {});
        return true;
      } catch (e) { return false; }
    }

    function mapRunAt(runAt) {
      if (runAt === "document_start") return "document_start";
      if (runAt === "document_end") return "document_end";
      return "document_idle";
    }

    // Re-register the content scripts dynamically (chrome.scripting) pointing at
    // the fresh files, so tabs opened AFTER an edit also get the new build. The
    // static manifest registration still points at the old content-hashed file
    // (it only updates on an extension reload) and keeps firing on new
    // navigations; the dynamic registration injects the new file alongside it,
    // and the wrapper's reinject runtime converges the mount to the newest build.
    // Idempotent: update an existing id, else register it.
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
        var js = (e.js || []).filter(function (f) { return typeof f === "string"; });
        var css = (e.css || []).filter(function (f) { return typeof f === "string"; });
        if (!js.length && !css.length) continue;
        var s = {
          id: "extjs-dev-cs-" + i,
          matches: e.matches,
          runAt: mapRunAt(e.run_at),
          allFrames: !!e.all_frames,
          world: e.world === "MAIN" ? "MAIN" : "ISOLATED"
        };
        if (js.length) s.js = js;
        if (css.length) s.css = css;
        scripts.push(s);
      }
      if (!scripts.length) return;

      try {
        chrome.scripting.getRegisteredContentScripts(function (existing) {
          try { void chrome.runtime.lastError; } catch (e) {}
          var have = {};
          if (existing) for (var k = 0; k < existing.length; k++) have[existing[k].id] = true;
          var toRegister = [], toUpdate = [];
          for (var j = 0; j < scripts.length; j++) {
            (have[scripts[j].id] ? toUpdate : toRegister).push(scripts[j]);
          }
          if (toRegister.length) {
            try { chrome.scripting.registerContentScripts(toRegister, noopLastError); } catch (e) {}
          }
          if (toUpdate.length) {
            try { chrome.scripting.updateContentScripts(toUpdate, noopLastError); } catch (e) {}
          }
        });
      } catch (e) {}
    }

    // Perform a dev-loop reload without the CDP controller:
    //   - content-scripts: re-inject the fresh script into open matching tabs in
    //     place (no extension restart), the controller-less equivalent of CDP
    //     reinjection. Needs the scripting permission + host access to the tab —
    //     both injected in dev by ApplyDevDefaults. Falls back to a full reload
    //     if scripting is unavailable.
    //   - service-worker / full / manifest: restart the whole extension so it
    //     re-registers from the fresh manifest.
    function performDevReload(type, onDone) {
      var chrome = g.chrome;
      if (!chrome) return;

      var fullReload = function () {
        // Deferred so any in-flight result/log frame — and the "Reloading…"
        // console announcement dispatched into tabs — flushes before the SW
        // dies. runtime.reload() restarts the whole extension; the devtools
        // companion confirms completion via chrome.management events, so no
        // onDone here.
        try { setTimeout(function () { try { chrome.runtime.reload(); } catch (e) {} }, 150); } catch (e) {}
      };

      if (type === "content-scripts" && chrome.scripting && chrome.tabs && chrome.tabs.query) {
        if (reinjectContentScripts(onDone)) return;
      }

      fullReload();
    }

    // ---- Dev-reload announcement surfaces --------------------------------
    // One server-built label travels the ReloadFrame; the producer echoes it
    // 1:1 into (a) the page's devtools console and (b) the bundled
    // extension-js-devtools companion (the bottom-left pill). Both fire HERE,
    // next to the actual reload action, so a surface can only say
    // "Reloading…" when a reload is actually being performed.

    // Stable IDs of the bundled extension-js-devtools companion: Chromium pins
    // via the manifest "key"; Firefox via browser_specific_settings.gecko.id.
    // Absent companion (e.g. --no-browser in the user's own browser) is fine —
    // sendMessage just reports no receiver and we swallow it.
    var DEVTOOLS_COMPANION_ID_CHROMIUM = "kgdaecdpfkikjncaalnmmnjjfpofkcbl";
    var DEVTOOLS_COMPANION_ID_FIREFOX = "devtools@extension.js";

    function notifyDevtoolsCompanion(phase, label, kind) {
      try {
        var chrome = g.chrome;
        if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") return;
        var id = engineName() === "firefox" ? DEVTOOLS_COMPANION_ID_FIREFOX : DEVTOOLS_COMPANION_ID_CHROMIUM;
        chrome.runtime.sendMessage(
          id,
          {type: "extjs-dev-reload-state", phase: phase, label: label || "", kind: kind || "", instanceId: INSTANCE_ID},
          function () { noopLastError(); }
        );
      } catch (e) {}
    }

    // console.log the reload line into every open injectable tab. Runs in the
    // user extension's ISOLATED world, where the bridge relay patched console —
    // so the same line also lands in the centralized dev-server log stream.
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
                } catch (e) {}
              }
              // MV2 fallback (Firefox without the scripting API).
              if (chrome.tabs.executeScript) {
                try {
                  chrome.tabs.executeScript(tab.id, {code: "console.log(" + JSON.stringify(text) + ");"}, noopLastError);
                } catch (e) {}
              }
            })(tabs[i]);
          }
        });
      } catch (e) {}
    }

    function handleDevReloadFrame(frame) {
      var kind = frame.reloadType || "full";
      var label = typeof frame.label === "string" ? frame.label : "";
      // The server always builds the label; the kind-derived fallback only
      // covers a malformed frame so the announcement stays truthful.
      var fallback = kind === "content-scripts" ? "content_script"
        : kind === "service-worker" ? "service_worker"
        : "extension";
      var announced = "[extension.js] Reloading " + (label || fallback) + "…";

      notifyDevtoolsCompanion("reloading", label, kind);

      if (kind === "page") {
        // Notify-only: rspack-dev-server's livereload refreshes the open
        // surface; reloading the extension here would race it. No tab console
        // line either — the reloading page clears its own console anyway.
        return;
      }

      announceReloadInTabs(announced);
      performDevReload(kind, function () {
        // Only the content-scripts path confirms from here (reinjection ran to
        // completion in this same SW). Full/SW reloads are confirmed by the
        // devtools companion's chrome.management listeners.
        notifyDevtoolsCompanion("reloaded", label, kind);
      });
    }

    function sanitize(args) {
      var out = [];
      for (var i = 0; i < args.length; i++) {
        var p = args[i];
        try {
          if (typeof p === "string") out.push(p.length > 2048 ? p.slice(0, 2048) + "..." : p);
          else if (p instanceof Error) out.push(p.name + ": " + p.message);
          else out.push(JSON.stringify(p));
        } catch (e) {
          out.push(String(p));
        }
        if (out.join(" ").length > 8192) break;
      }
      return out;
    }

    function flush() {
      while (queue.length && open && socket) {
        var f = queue.shift();
        try { socket.send(JSON.stringify(f)); } catch (e) { break; }
      }
    }

    function send(frame) {
      if (open && socket) {
        try { socket.send(JSON.stringify(frame)); return; } catch (e) {}
      }
      if (queue.length < MAX_QUEUE) queue.push(frame);
    }

    function schedule() {
      var delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
      try { setTimeout(connect, delay); } catch (e) {}
    }

    function connect() {
      try {
        socket = new WS("ws://" + HOST + ":" + PORT + "/extjs-control");
      } catch (e) {
        schedule();
        return;
      }
      socket.onopen = function () {
        open = true;
        backoff = 250;
        try {
          socket.send(JSON.stringify({type: "hello", v: 1, role: "producer", instanceId: INSTANCE_ID}));
        } catch (e) {}
        flush();
      };
      socket.onmessage = function (ev) {
        // Slice 2: the broker routes authorized command frames to this SW.
        var frame;
        try { frame = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch (e) { return; }
        if (frame && frame.type === "command") {
          try { executeCommand(frame); } catch (e) { replyErr(frame.cmdId, "ExecutorError", e); }
        } else if (frame && frame.type === "reload") {
          // Dev-loop reload broadcast (see broker.broadcastReload).
          // Fire-and-forget: no result frame is expected.
          try { handleDevReloadFrame(frame); } catch (e) {}
        }
      };
      socket.onclose = function () {
        open = false;
        socket = null;
        schedule();
      };
      socket.onerror = function () {
        try { socket && socket.close(); } catch (e) {}
      };
    }

    LEVELS.forEach(function (level) {
      var orig = typeof consoleRef[level] === "function"
        ? consoleRef[level].bind(consoleRef)
        : function () {};
      consoleRef[level] = function () {
        try {
          send({
            type: "log",
            event: {
              v: 1,
              id: nowId(),
              timestamp: Date.now(),
              level: level,
              context: CONTEXT,
              messageParts: sanitize([].slice.call(arguments)),
              runId: INSTANCE_ID
            }
          });
        } catch (e) {}
        return orig.apply(consoleRef, arguments);
      };
    });

    // Multi-context console forwarding: other contexts (content scripts, surface
    // pages) can't reliably open ws://127.0.0.1 (page CSP / connect-src), so they
    // relay console via chrome.runtime.sendMessage to this SW, which owns the WS.
    // We enrich with the real tabId/url from the message sender.
    try {
      var rt = g.chrome;
      if (rt && rt.runtime && rt.runtime.onMessage) {
        rt.runtime.onMessage.addListener(function (msg, sender) {
          if (!msg || !msg.__extjsBridgeLog) return;
          var ev = msg.__extjsBridgeLog;
          try {
            send({
              type: "log",
              event: {
                v: 1,
                id: nowId(),
                timestamp: Date.now(),
                level: ev.level || "log",
                context: ev.context || "content",
                messageParts: Array.isArray(ev.messageParts) ? ev.messageParts : [],
                url: ev.url || (sender ? sender.url : undefined),
                tabId: sender && sender.tab ? sender.tab.id : undefined,
                frameId: sender ? sender.frameId : undefined,
                runId: INSTANCE_ID
              }
            });
          } catch (e) {}
          // No async response.
        });
      }
    } catch (e) {}

    connect();
  } catch (e) {}
})();
`

/**
 * Lightweight RELAY for non-SW contexts (content scripts, surface pages). It
 * patches console and forwards each call to the background SW via
 * chrome.runtime.sendMessage({__extjsBridgeLog}); the SW producer (above) stamps
 * tabId/url and ships it over the control WS. No WebSocket, no executor here —
 * content scripts usually can't open ws://127.0.0.1 under the page's CSP.
 */
export const BRIDGE_RELAY_SOURCE = `;(function () {
  try {
    var g = (typeof globalThis === "object" && globalThis) ? globalThis : this;
    if (!g || g.__extjsBridgeRelayInstalled) return;

    var CONTEXT = "__EXTJS_CONTEXT__";
    var chrome = g.chrome;
    if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") return;

    g.__extjsBridgeRelayInstalled = true;
    var consoleRef = g.console || {};
    var LEVELS = ["log", "info", "warn", "error", "debug", "trace"];

    function sanitize(args) {
      var out = [];
      for (var i = 0; i < args.length; i++) {
        var p = args[i];
        try {
          if (typeof p === "string") out.push(p.length > 2048 ? p.slice(0, 2048) + "..." : p);
          else if (p instanceof Error) out.push(p.name + ": " + p.message);
          else out.push(JSON.stringify(p));
        } catch (e) { out.push(String(p)); }
        if (out.join(" ").length > 8192) break;
      }
      return out;
    }

    function here() { try { return g.location ? g.location.href : undefined; } catch (e) { return undefined; } }

    LEVELS.forEach(function (level) {
      var orig = typeof consoleRef[level] === "function" ? consoleRef[level].bind(consoleRef) : function () {};
      consoleRef[level] = function () {
        try {
          chrome.runtime.sendMessage(
            {__extjsBridgeLog: {level: level, context: CONTEXT, messageParts: sanitize([].slice.call(arguments)), url: here()}},
            function () { void chrome.runtime.lastError; } // swallow "no receiver" while the SW wakes
          );
        } catch (e) {}
        return orig.apply(consoleRef, arguments);
      };
    });

    // Surface DOM inspection: the SW executor can't reach popup/options/sidebar
    // DOM (separate extension pages), and the sidecar can't either (cross-extension
    // isolation). So THIS page — the user extension's own surface — answers an
    // inspect request for its own context. The SW broadcasts the request; only the
    // matching-context surface responds with its DOM snapshot.
    try {
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
          if (!msg || !msg.__extjsInspectRequest) return;
          if (!msg.target || msg.target.context !== CONTEXT) return; // not for me
          try {
            var args = msg.args || {};
            var wantHtml = !args.include || args.include.indexOf("html") !== -1;
            var cap = args.maxBytes || 262144;
            function countShadow(root) {
              var n = 0, els = root.querySelectorAll("*");
              for (var i = 0; i < els.length; i++) { if (els[i].shadowRoot) { n++; n += countShadow(els[i].shadowRoot); } }
              return n;
            }
            var doc = g.document;
            var roots = doc.querySelectorAll('#extension-root,[data-extension-root]');
            var snap = {
              context: CONTEXT,
              url: here(),
              title: doc.title,
              summary: {
                htmlLength: doc.documentElement.outerHTML.length,
                scriptCount: doc.querySelectorAll("script").length,
                styleCount: doc.querySelectorAll("style,link[rel=stylesheet]").length,
                extensionRootCount: roots.length,
                openShadowRoots: countShadow(doc),
                bodyChildCount: doc.body ? doc.body.children.length : 0
              }
            };
            if (wantHtml) {
              var html = doc.documentElement.outerHTML;
              if (cap > 0 && html.length > cap) { snap.html = html.slice(0, cap); snap.htmlTruncated = true; }
              else { snap.html = html; }
            }
            sendResponse({ok: true, value: snap});
          } catch (e) {
            sendResponse({ok: false, error: {name: "InspectError", message: String(e)}});
          }
          return true; // responded
        });
      }
    } catch (e) {}
  } catch (e) {}
})();
`

export interface BuildRelayOptions {
  context: string
}

/** Bake the context into the relay source (content/page/popup/options/...). */
export function buildBridgeRelaySource(opts: BuildRelayOptions): string {
  return BRIDGE_RELAY_SOURCE.replace(
    /__EXTJS_CONTEXT__/g,
    String(opts.context || 'content')
  )
}

export interface BuildProducerOptions {
  controlPort: number | null | undefined
  instanceId: string
  context?: string
  /** Connectable host of the control WS. Defaults to 127.0.0.1 (local). */
  host?: string
}

/**
 * Bake the control port / instanceId / context / host into the producer source.
 * Returns '' when the control bridge is unavailable (no port) so callers can
 * safely skip injection.
 */
export function buildBridgeProducerSource(opts: BuildProducerOptions): string {
  if (!opts.controlPort || opts.controlPort < 1) return ''
  return BRIDGE_PRODUCER_SOURCE.replace(
    /__EXTJS_CONTROL_PORT__/g,
    String(opts.controlPort)
  )
    .replace(/__EXTJS_INSTANCE_ID__/g, String(opts.instanceId))
    .replace(/__EXTJS_CONTEXT__/g, String(opts.context || 'background'))
    .replace(/__EXTJS_CONTROL_HOST__/g, String(opts.host || '127.0.0.1'))
}
