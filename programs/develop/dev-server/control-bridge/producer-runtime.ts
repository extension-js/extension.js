// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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

    // Capture extension event listeners at install time: these wraps run
    // BEFORE user code, and no platform API exists to dispatch these events.
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

    // Use g.chrome (not the hoisted chrome var below). This runs first.
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

    // Resolve a numeric tab id when the caller did not pass one: match
    // target.url against open tabs, else default to the active tab. (#51)
    function resolveTargetTab(target, cb) {
      var chrome = g.chrome;
      if (!chrome || !chrome.tabs) { cb(null, "chrome.tabs is not available"); return; }
      var url = target && target.url;
      if (url) {
        var substringMatch = function () {
          try {
            chrome.tabs.query({}, function (all) {
              var hit = (all || []).filter(function (t) { return t.url && String(t.url).indexOf(url) !== -1; })[0];
              if (hit && typeof hit.id === "number") { cb(hit.id, null); return; }
              cb(null, "no open tab matches url: " + url);
            });
          } catch (e2) { cb(null, "tab query failed"); }
        };
        try {
          // chrome.tabs.query accepts URL match patterns; a bare url/glob may
          // not be a valid pattern, so fall back to a substring scan.
          chrome.tabs.query({url: url}, function (tabs) {
            if (chrome.runtime && chrome.runtime.lastError) { substringMatch(); return; }
            if (tabs && tabs.length && typeof tabs[0].id === "number") { cb(tabs[0].id, null); return; }
            substringMatch();
          });
        } catch (e) { substringMatch(); }
        return;
      }
      try {
        chrome.tabs.query({active: true, lastFocusedWindow: true}, function (tabs) {
          var t = tabs && tabs[0];
          if (t && typeof t.id === "number") { cb(t.id, null); return; }
          cb(null, "no active tab to target");
        });
      } catch (e3) { cb(null, "tab query failed"); }
    }

    // chrome.* async APIs are callback-only on Gecko. Prefer promisified
    // browser.* when present, else the chrome.* callback form. cb(err, result).
    function nsCall(nsName, method, callArgs, cb) {
      var chromeG = g.chrome;
      var done = false;
      var once = function (err, r) { if (!done) { done = true; cb(err, r); } };
      var viaPromise = function (ns) {
        try {
          var ret = ns[method].apply(ns, callArgs);
          if (ret && typeof ret.then === "function") {
            ret.then(function (r) { once(null, r); }, function (e) { once(e); });
            return true;
          }
        } catch (e) { once(e); return true; }
        return false;
      };
      var bNS = g.browser && g.browser[nsName];
      if (bNS && typeof bNS[method] === "function" && viaPromise(bNS)) return;
      var cNS = chromeG && chromeG[nsName];
      if (!cNS || typeof cNS[method] !== "function") {
        once(new Error("chrome." + nsName + "." + method + " is not available (engine: " + engineName() + ")"));
        return;
      }
      try {
        var ret2 = cNS[method].apply(cNS, callArgs.concat([function (r) {
          var le = chromeG.runtime && chromeG.runtime.lastError;
          if (le) once(le); else once(null, r);
        }]));
        // A promise-only implementation ignores the trailing callback and
        // returns a thenable instead; resolve through it (once() dedupes).
        if (ret2 && typeof ret2.then === "function") {
          ret2.then(function (r) { once(null, r); }, function (e) { once(e); });
        }
      } catch (e2) {
        if (!viaPromise(cNS)) once(e2);
      }
    }

    function executeCommand(cmd) {
      var op = cmd.op, target = cmd.target || {}, args = cmd.args || {};
      var ctx = target.context || "background";
      var chrome = g.chrome;
      var cmdId = cmd.cmdId;
      // content/page eval & inspect need a numeric tab id: resolve --url (or
      // nothing) to a tab and re-dispatch with target.tabId filled in. (#51)
      if ((op === "eval" || op === "inspect") && (ctx === "content" || ctx === "page") && target.tabId == null) {
        resolveTargetTab(target, function (tabId, err) {
          if (tabId == null) {
            replyErr(cmdId, "Unsupported", err || ("eval/inspect in context " + ctx + " needs a --tab id, a --url to match, or an active tab"));
            return;
          }
          var next = {};
          for (var k in cmd) { if (Object.prototype.hasOwnProperty.call(cmd, k)) next[k] = cmd[k]; }
          next.target = {};
          for (var tk in target) { if (Object.prototype.hasOwnProperty.call(target, tk)) next.target[tk] = target[tk]; }
          next.target.tabId = tabId;
          executeCommand(next);
        });
        return;
      }
      try {
        if (!chrome) { replyErr(cmdId, "Unsupported", "chrome.* not available in this context"); return; }
        if (op === "eval") {
          if (ctx === "background") {
            Promise.resolve().then(function () { return (0, eval)(args.expression); })
              .then(function (r) { replyOk(cmdId, r); }, function (e) {
                var msg = (e && e.message) || String(e);
                // MV3 forbids eval of strings in the SW/extension pages and
                // rejects 'unsafe-eval'. Surface it honestly with an alternative.
                if (/Content Security Policy|unsafe-eval/i.test(msg)) {
                  replyErr(cmdId, "Unsupported", "eval is blocked in the MV3 service worker by CSP. Use --context page --tab <id> (eval runs in the page's MAIN world), or run on an MV2/Firefox build. Engine: " + engineName());
                } else {
                  replyErr(cmdId, (e && e.name) || "EvalError", msg);
                }
              });
          } else if ((ctx === "content" || ctx === "page") && target.tabId && chrome.scripting) {
            // Wrap the eval so a throw INSIDE the tab comes back as data:
            // Chrome swallows an injected function's exception (null result).
            nsCall("scripting", "executeScript", [{
              target: {tabId: target.tabId},
              world: ctx === "page" ? "MAIN" : "ISOLATED",
              func: function (src) {
                try { return {__extjsEval: 1, ok: true, value: eval(src)}; }
                catch (e) { return {__extjsEval: 1, ok: false, name: (e && e.name) || "EvalError", message: (e && e.message) || String(e)}; }
              },
              args: [String(args.expression)]
            }], function (err, res) {
              if (err) { replyErr(cmdId, "EvalError", (err && err.message) || err); return; }
              var frame = res && res[0] ? res[0].result : undefined;
              if (!frame || frame.__extjsEval !== 1) {
                replyErr(cmdId, "EvalError", "the expression never executed in tab " + target.tabId + ": no injectable frame returned a result (restricted page, or outside host_permissions)");
                return;
              }
              if (frame.ok) { replyOk(cmdId, frame.value); return; }
              if (ctx === "content" && /Content Security Policy|unsafe-eval|EvalError/i.test(String(frame.name) + " " + String(frame.message))) {
                replyErr(cmdId, "Unsupported", "eval of a string is blocked in the ISOLATED (content) world by the extension CSP. Use --context page (runs in the page's MAIN world). Original: " + frame.message);
                return;
              }
              replyErr(cmdId, frame.name || "EvalError", frame.message);
            });
          } else if (ctx === "popup" || ctx === "options" || ctx === "sidebar" || ctx === "devtools" || ctx === "newtab" || ctx === "history" || ctx === "bookmarks") {
            // The SW can't eval in another extension page; ask the surface's
            // own in-bundle relay (only the open, matching-context page responds).
            chrome.runtime.sendMessage(
              {__extjsEvalRequest: true, target: target, args: {expression: String(args.expression)}},
              function (resp) {
                if ((chrome.runtime && chrome.runtime.lastError) || !resp) {
                  replyErr(cmdId, "Unsupported", "surface '" + ctx + "' is not open (open it first: extension open " + ctx + ")");
                } else if (resp.ok) {
                  replyOk(cmdId, resp.value);
                } else {
                  replyErr(cmdId, (resp.error && resp.error.name) || "EvalError", (resp.error && resp.error.message) || "eval failed");
                }
              }
            );
          } else if (ctx === "content" || ctx === "page") {
            replyErr(cmdId, "Unsupported", target.tabId
              ? "chrome.scripting is not available on this engine (MV2 has no scripting API); use --context background"
              : "eval in context " + ctx + " requires a tabId");
          } else {
            replyErr(cmdId, "BadRequest", "unknown eval context: " + ctx);
          }
          return;
        }
        if (op === "storage.get" || op === "storage.set") {
          // chrome.* storage is callback-only on Gecko and older Chromium.
          // Prefer promisified browser.*, then fall back to the callback shape.
          var storageNS = (g.browser && g.browser.storage) ? g.browser.storage : chrome.storage;
          var storageArea = storageNS && storageNS[args.area || "local"];
          if (!storageArea) { replyErr(cmdId, "StorageError", "storage." + (args.area || "local") + " unavailable"); return; }
          var isSet = op === "storage.set";
          var callArgs = isSet ? [args.items || {}] : [args.key != null ? args.key : null];
          var onStorageOk = function (r) { replyOk(cmdId, isSet ? {set: Object.keys(args.items || {})} : r); };
          var onStorageErr = function (e) { replyErr(cmdId, "StorageError", (e && e.message) || String(e)); };
          var storageFn = isSet ? storageArea.set : storageArea.get;
          try {
            var storageRet = storageFn.apply(storageArea, callArgs);
            if (storageRet && typeof storageRet.then === "function") {
              storageRet.then(onStorageOk, onStorageErr);
              return;
            }
          } catch (e) { /* not thenable / threw synchronously: fall back to callback */ }
          try {
            storageFn.apply(storageArea, callArgs.concat([function (r) {
              var le = chrome.runtime && chrome.runtime.lastError;
              if (le) onStorageErr(le); else onStorageOk(r);
            }]));
          } catch (e) { onStorageErr(e); }
          return;
        }
        if (op === "reload") {
          if (ctx === "background") {
            replyOk(cmdId, {reloading: true});
            setTimeout(function () { try { chrome.runtime.reload(); } catch (e) {} }, 50);
          } else if (target.tabId) {
            nsCall("tabs", "reload", [target.tabId], function (err) {
              if (err) replyErr(cmdId, "ReloadError", (err && err.message) || err);
              else replyOk(cmdId, {reloaded: target.tabId});
            });
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
          var resolveActiveTab = function (a, cb) {
            if (a && typeof a.tabId === "number") {
              try { chrome.tabs.get(a.tabId, function (t) { cb(t || {id: a.tabId}); }); return; }
              catch (e) {}
            }
            try { chrome.tabs.query({active: true, lastFocusedWindow: true}, function (tabs) { cb((tabs && tabs[0]) || undefined); }); }
            catch (e) { cb(undefined); }
          };
          // Replaying a listener carries no user gesture, so activeTab is never
          // granted. Warn when the manifest declares it.
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
              nsCall("action", "openPopup", [], function (err) {
                if (err) replyErr(cmdId, "Unsupported", "openPopup: " + ((err && err.message) || err));
                else replyOk(cmdId, {opened: "popup"});
              });
            } else { replyErr(cmdId, "Unsupported", "action.openPopup not available"); }
          } else if (surface === "options") {
            try { chrome.runtime.openOptionsPage(function () { replyOk(cmdId, {opened: "options"}); }); }
            catch (e) { replyErr(cmdId, "Unsupported", "openOptionsPage: " + e); }
          } else if (surface === "sidebar") {
            if (chrome.sidePanel && chrome.sidePanel.open && chrome.windows) {
              chrome.windows.getCurrent(function (w) {
                nsCall("sidePanel", "open", [{windowId: w.id}], function (err) {
                  if (err) replyErr(cmdId, "Unsupported", "sidePanel.open: " + ((err && err.message) || err));
                  else replyOk(cmdId, {opened: "sidebar"});
                });
              });
            } else { replyErr(cmdId, "Unsupported", "sidePanel not available (engine: " + engineName() + ")"); }
          } else if (surface === "action") {
            // With a default_popup the click opens it; without one, replay the
            // onClicked listeners captured at install time.
            if (chrome.action) {
              getActionPopup(function (popup) {
                if (popup) {
                  nsCall("action", "openPopup", [], function (err) {
                    if (err) replyErr(cmdId, "Unsupported", "openPopup: " + ((err && err.message) || err));
                    else replyOk(cmdId, {triggered: "popup"});
                  });
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
          nsCall("tabs", "query", [args || {}], function (err, tabs) {
            if (err) { replyErr(cmdId, "TabsError", (err && err.message) || err); return; }
            replyOk(cmdId, (tabs || []).map(function (t) { return {id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId}; }));
          });
          return;
        }
        if (op === "inspect") {
          // Extract a DOM snapshot from the target page via chrome.scripting
          // (CDP-free). Closed shadow roots need CDP; here we read open ones.
          if ((ctx === "content" || ctx === "page") && target.tabId && chrome.scripting) {
            var maxBytes = (args && args.maxBytes) || 262144;
            var includeHtml = !args || !args.include || args.include.indexOf("html") !== -1;
            nsCall("scripting", "executeScript", [{
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
            }], function (err, res) {
              if (err) { replyErr(cmdId, "InspectError", (err && err.message) || err); return; }
              var snap = res && res[0] ? res[0].result : undefined;
              if (snap == null) { replyErr(cmdId, "InspectError", "no injectable frame returned a snapshot for tab " + target.tabId + " (restricted page, or outside host_permissions)"); return; }
              replyOk(cmdId, snap);
            });
          } else if (ctx === "popup" || ctx === "options" || ctx === "sidebar" || ctx === "devtools" || ctx === "newtab" || ctx === "history" || ctx === "bookmarks") {
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

    // Re-inject one declared entry's fresh files into every matching open tab.
    // exclude_matches MUST be honored: query the excludes and subtract them.
    function reinjectContentScriptEntry(entry) {
      var chrome = g.chrome;
      var matches = (entry && entry.matches) || [];
      if (!Array.isArray(matches) || !matches.length) return;
      var excludeMatches = (entry && entry.exclude_matches) || [];
      var jsFiles = ((entry && entry.js) || []).filter(function (f) { return typeof f === "string"; });
      var cssFiles = ((entry && entry.css) || []).filter(function (f) { return typeof f === "string"; });
      if (!jsFiles.length && !cssFiles.length) return;
      var world = entry.world === "MAIN" ? "MAIN" : "ISOLATED";
      var allFrames = !!entry.all_frames;
      function injectInto(excludedTabIds) {
        try {
          chrome.tabs.query({url: matches}, function (tabs) {
            var err = null;
            try { err = chrome.runtime.lastError; } catch (e) {}
            if (err || !tabs) return;
            for (var i = 0; i < tabs.length; i++) {
              (function (tab) {
                if (!tab || tab.id == null || !isInjectableUrl(tab.url)) return;
                if (excludedTabIds[tab.id]) return;
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
      if (Array.isArray(excludeMatches) && excludeMatches.length) {
        try {
          chrome.tabs.query({url: excludeMatches}, function (excludedTabs) {
            try { void chrome.runtime.lastError; } catch (e) {}
            var excluded = {};
            if (excludedTabs) {
              for (var i = 0; i < excludedTabs.length; i++) {
                if (excludedTabs[i] && excludedTabs[i].id != null) excluded[excludedTabs[i].id] = true;
              }
            }
            injectInto(excluded);
          });
          return;
        } catch (e) {}
      }
      injectInto({});
    }

    // Re-inject all content scripts into their open tabs. Reads the manifest
    // FROM DISK: getManifest() is frozen and dev filenames are content-hashed.
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
        // Dev registration must not be BROADER than the static one: dropping
        // exclude_matches injects into pages the browser itself would skip.
        if (Array.isArray(e.exclude_matches) && e.exclude_matches.length) {
          s.excludeMatches = e.exclude_matches;
        }
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

    // Dev-loop reload without the CDP controller: content-scripts re-inject in
    // place into open tabs; service-worker/full/manifest restart the extension.
    function performDevReload(type, onDone) {
      var chrome = g.chrome;
      if (!chrome) return;

      var fullReload = function () {
        // Flag a pending reinject for the NEXT producer generation: the
        // boot-time heal is what converges open tabs after a SW/full reload.
        try {
          if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({__extjsDevPendingReinject: Date.now()}, noopLastError);
          }
        } catch (e) {}
        // Deferred so in-flight frames and the tab console announcement flush
        // before the SW dies; the devtools companion confirms completion.
        try { setTimeout(function () { try { chrome.runtime.reload(); } catch (e) {} }, 150); } catch (e) {}
      };

      if (type === "content-scripts" && chrome.scripting && chrome.tabs && chrome.tabs.query) {
        if (reinjectContentScripts(onDone)) return;
      }

      fullReload();
    }

    // One server-built label travels the ReloadFrame; both announcement
    // surfaces fire HERE, next to the actual reload action, so they stay true.

    // Stable IDs of the bundled extension-js-devtools companion: Chromium pins
    // via the manifest "key"; Firefox via browser_specific_settings.gecko.id.
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
        // surface; reloading the extension here would race it.
        return;
      }

      // Delivery ack for the broker: proves this SW's message pump processed
      // the frame (a socket write proves nothing). Sent on receipt, by design.
      send({type: "reload-ack", reloadType: kind, label: label});

      announceReloadInTabs(announced);
      performDevReload(kind, function () {
        // Only the content-scripts path confirms from here; full/SW reloads
        // are confirmed by the devtools companion's chrome.management listeners.
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
        var frame;
        try { frame = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch (e) { return; }
        if (frame && frame.type === "command") {
          try { executeCommand(frame); } catch (e) { replyErr(frame.cmdId, "ExecutorError", e); }
        } else if (frame && frame.type === "reload") {
          // Dev-loop reload broadcast (see broker.broadcastReload).
          // Fire-and-forget: no result frame is expected.
          try { handleDevReloadFrame(frame); } catch (e) {}
        } else if (frame && frame.type === "ping") {
          // Server keepalive: merely RECEIVING this resets the MV3 SW's ~30s
          // idle timer (Chrome 116+), keeping it reachable. Nothing to do.
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

    // Uncaught errors don't route through the patched console; the handlers
    // below forward them, using these signatures to skip already-logged throws.
    var recentErrorSigs = [];
    function errorSig(message, stack) {
      return String(message == null ? "" : message) + "::" + String(stack == null ? "" : stack).slice(0, 200);
    }
    function noteErrorSig(sig) {
      recentErrorSigs.push({sig: sig, t: Date.now()});
      if (recentErrorSigs.length > 50) recentErrorSigs.shift();
    }
    function errorSigSeenRecently(sig) {
      var now = Date.now();
      for (var i = recentErrorSigs.length - 1; i >= 0; i--) {
        if (now - recentErrorSigs[i].t > 3000) { recentErrorSigs.splice(i, 1); continue; }
        if (recentErrorSigs[i].sig === sig) return true;
      }
      return false;
    }

    LEVELS.forEach(function (level) {
      var orig = typeof consoleRef[level] === "function"
        ? consoleRef[level].bind(consoleRef)
        : function () {};
      consoleRef[level] = function () {
        try {
          if (level === "error") {
            for (var ai = 0; ai < arguments.length; ai++) {
              if (arguments[ai] instanceof Error) noteErrorSig(errorSig(arguments[ai].message, arguments[ai].stack));
            }
          }
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

    // Forward uncaught throws / unhandled rejections as level:"error", deduped
    // so a logged-then-rethrown Error emits once.
    function shipUncaughtError(message, stack, url) {
      try {
        var sig = errorSig(message, stack);
        if (errorSigSeenRecently(sig)) return;
        noteErrorSig(sig);
        send({
          type: "log",
          event: {
            v: 1,
            id: nowId(),
            timestamp: Date.now(),
            level: "error",
            context: CONTEXT,
            messageParts: sanitize([String(message) + (stack ? "\\n" + stack : "")]),
            url: url,
            runId: INSTANCE_ID
          }
        });
      } catch (e) {}
    }
    try {
      if (typeof g.addEventListener === "function") {
        g.addEventListener("error", function (ev) {
          var err = ev && ev.error;
          var message = (err && err.message) || (ev && ev.message) || "Uncaught error";
          shipUncaughtError(message, err && err.stack, ev && ev.filename);
        });
        g.addEventListener("unhandledrejection", function (ev) {
          var reason = ev && ev.reason;
          var message = (reason && reason.message) || (reason != null ? String(reason) : "Unhandled rejection");
          shipUncaughtError("Unhandled promise rejection: " + message, reason && reason.stack, undefined);
        });
      }
    } catch (e) {}

    // Other contexts relay console logs to this SW over a NAMED runtime.Port:
    // they can't open the WS under page CSP, and sendMessage can echo-loop.
    function shipRelayedLog(ev, sender) {
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
    }
    try {
      var rtPort = g.chrome;
      if (rtPort && rtPort.runtime && rtPort.runtime.onConnect) {
        rtPort.runtime.onConnect.addListener(function (port) {
          if (!port || port.name !== "__extjs-bridge-log__") return;
          try {
            port.onMessage.addListener(function (msg) {
              if (!msg || !msg.__extjsBridgeLog) return;
              shipRelayedLog(msg.__extjsBridgeLog, port.sender);
            });
          } catch (e) {}
        });
      }
    } catch (e) {}
    // Legacy sendMessage path: kept for any surface still relaying the old way
    // (harmless one-predicate listener; new relays never use it).
    try {
      var rt = g.chrome;
      if (rt && rt.runtime && rt.runtime.onMessage) {
        rt.runtime.onMessage.addListener(function (msg, sender) {
          if (!msg || !msg.__extjsBridgeLog) return;
          shipRelayedLog(msg.__extjsBridgeLog, sender);
        });
      }
    } catch (e) {}

    // Chrome never injects manifest content scripts into already-open tabs, so
    // fire one reinject on onInstalled (which skips idle-stop SW wakes).
    try {
      var rtBoot = g.chrome;
      if (rtBoot && rtBoot.runtime && rtBoot.runtime.onInstalled) {
        rtBoot.runtime.onInstalled.addListener(function () {
          try {
            setTimeout(function () {
              try { reinjectContentScripts(); } catch (e) {}
            }, 250);
          } catch (e) {}
        });
      }
    } catch (e) {}

    // runtime.reload() does NOT fire onInstalled (verified Chromium 146), so
    // consume the pre-reload storage flag here (fresh only) to heal open tabs.
    try {
      var stBoot = g.chrome;
      if (stBoot && stBoot.storage && stBoot.storage.local) {
        stBoot.storage.local.get("__extjsDevPendingReinject", function (res) {
          noopLastError();
          var ts = res && res.__extjsDevPendingReinject;
          if (ts == null) return;
          try { stBoot.storage.local.remove("__extjsDevPendingReinject", noopLastError); } catch (e) {}
          if (typeof ts !== "number" || Date.now() - ts > 30000) return;
          setTimeout(function () {
            try { reinjectContentScripts(); } catch (e) {}
          }, 250);
        });
      }
    } catch (e) {}

    connect();
  } catch (e) {}
})();
`

// Lightweight console RELAY for non-SW contexts: forwards each call to the SW
// over a NAMED runtime.Port so the extension's own onMessage never loops on it.
export const BRIDGE_RELAY_SOURCE = `;(function () {
  try {
    var g = (typeof globalThis === "object" && globalThis) ? globalThis : this;
    if (!g || g.__extjsBridgeRelayInstalled) return;

    var CONTEXT = "__EXTJS_CONTEXT__";
    var chrome = g.chrome;
    if (!chrome || !chrome.runtime) return;
    var canRelay = typeof chrome.runtime.connect === "function";

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

    // Lazy named port to the SW producer: connecting wakes an idle SW, but
    // port frames never reach the extension's own onMessage listeners.
    var logPort = null;
    function getLogPort() {
      if (!canRelay) return null;
      if (logPort) return logPort;
      try {
        logPort = chrome.runtime.connect({name: "__extjs-bridge-log__"});
        logPort.onDisconnect.addListener(function () {
          try { void chrome.runtime.lastError; } catch (e) {}
          logPort = null;
        });
      } catch (e) { logPort = null; }
      return logPort;
    }

    // Relay one log payload to the SW producer over the named port, redialing
    // once if the port went stale (SW restarted).
    function postLog(payload) {
      var p = getLogPort();
      if (!p) return;
      try {
        p.postMessage({__extjsBridgeLog: payload});
      } catch (e) {
        logPort = null;
        var p2 = getLogPort();
        if (p2) { try { p2.postMessage({__extjsBridgeLog: payload}); } catch (e2) {} }
      }
    }

    // Uncaught throws / unhandled rejections never route through the patched
    // console; forward them, deduped against console.error Error signatures.
    var recentErrorSigs = [];
    function errorSig(message, stack) {
      return String(message == null ? "" : message) + "::" + String(stack == null ? "" : stack).slice(0, 200);
    }
    function noteErrorSig(sig) {
      recentErrorSigs.push({sig: sig, t: Date.now()});
      if (recentErrorSigs.length > 50) recentErrorSigs.shift();
    }
    function errorSigSeenRecently(sig) {
      var now = Date.now();
      for (var i = recentErrorSigs.length - 1; i >= 0; i--) {
        if (now - recentErrorSigs[i].t > 3000) { recentErrorSigs.splice(i, 1); continue; }
        if (recentErrorSigs[i].sig === sig) return true;
      }
      return false;
    }

    LEVELS.forEach(function (level) {
      var orig = typeof consoleRef[level] === "function" ? consoleRef[level].bind(consoleRef) : function () {};
      consoleRef[level] = function () {
        try {
          if (level === "error") {
            for (var ai = 0; ai < arguments.length; ai++) {
              if (arguments[ai] instanceof Error) noteErrorSig(errorSig(arguments[ai].message, arguments[ai].stack));
            }
          }
          postLog({level: level, context: CONTEXT, messageParts: sanitize([].slice.call(arguments)), url: here()});
        } catch (e) {}
        return orig.apply(consoleRef, arguments);
      };
    });

    function shipUncaughtError(message, stack, url) {
      try {
        var sig = errorSig(message, stack);
        if (errorSigSeenRecently(sig)) return;
        noteErrorSig(sig);
        postLog({level: "error", context: CONTEXT, messageParts: sanitize([String(message) + (stack ? "\\n" + stack : "")]), url: url || here()});
      } catch (e) {}
    }
    try {
      if (typeof g.addEventListener === "function") {
        g.addEventListener("error", function (ev) {
          var err = ev && ev.error;
          var message = (err && err.message) || (ev && ev.message) || "Uncaught error";
          shipUncaughtError(message, err && err.stack, (ev && ev.filename) || undefined);
        });
        g.addEventListener("unhandledrejection", function (ev) {
          var reason = ev && ev.reason;
          var message = (reason && reason.message) || (reason != null ? String(reason) : "Unhandled rejection");
          shipUncaughtError("Unhandled promise rejection: " + message, reason && reason.stack, undefined);
        });
      }
    } catch (e) {}

    // The SW executor can't reach another extension page's DOM or eval there,
    // so THIS surface answers inspect/eval requests for its own context.
    try {
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
          if (!msg || !msg.__extjsEvalRequest) return;
          if (!msg.target || msg.target.context !== CONTEXT) return; // not for me
          try {
            var value = (0, eval)(String((msg.args && msg.args.expression) || ""));
            try { sendResponse({ok: true, value: value}); }
            catch (eSend) { sendResponse({ok: true, value: String(value)}); }
          } catch (e) {
            var emsg = (e && e.message) || String(e);
            if (/Content Security Policy|unsafe-eval|call to eval/i.test(emsg)) {
              sendResponse({ok: false, error: {name: "Unsupported", message: "eval of a string is blocked in the " + CONTEXT + " page by the MV3 extension CSP. Use extension inspect " + CONTEXT + " to read its DOM, or --context background on an MV2/Firefox build. Original: " + emsg}});
            } else {
              sendResponse({ok: false, error: {name: (e && e.name) || "EvalError", message: emsg}});
            }
          }
          return true; // responded
        });
      }
    } catch (e) {}

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

// Bake the control port / instanceId / context / host into the producer source.
// Returns '' when the control bridge is unavailable (no port).
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
