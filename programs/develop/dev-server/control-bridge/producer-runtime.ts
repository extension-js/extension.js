// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export const CONTROL_PORT_ASSET_NAME = 'extension-js-control.json'

// The bridge core: the connection, the control verbs and the logs. The
// caller hands in what runs a reload, which lands between these parts.
const PRODUCER_HEAD = `;(function () {
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
    // A dev background names no session, so its file is the same bytes in
    // every session and a kept profile's cached copy of it is not stale.
    var SESSION_FROM_FILE = "__EXTJS_SESSION_FROM_FILE__" === "1";
    if (SESSION_FROM_FILE) { PORT = 0; INSTANCE_ID = ""; }
    else if (!PORT || PORT < 1) return;

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

    // Use the raw globals (not the hoisted chrome var below). This runs first.
    // On Gecko browser.* is a DISTINCT wrapper object: hook BOTH namespaces.
    // One sink per manifest key, so a replay fires only the entry it clicks.
    var ACTION_KEYS = ["action", "browser_action", "page_action"];
    var ACTION_NAMESPACES = {action: "action", browser_action: "browserAction", page_action: "pageAction"};
    var actionClickedListeners = {action: [], browser_action: [], page_action: []};
    var commandListeners = [];
    var capturedEvents = [];
    function captureEventOnce(event, sink) {
      // Polyfilled extensions expose ONE event object on both namespaces:
      // wrap it once, and the sink dedupes callbacks shared across wrappers.
      if (!event || capturedEvents.indexOf(event) !== -1) return;
      capturedEvents.push(event);
      captureEvent(event, sink);
    }
    var captureNamespaces = [g.chrome, g.browser];
    for (var cn = 0; cn < captureNamespaces.length; cn++) {
      var capNS = captureNamespaces[cn];
      if (!capNS) continue;
      for (var ak = 0; ak < ACTION_KEYS.length; ak++) {
        var akNS = capNS[ACTION_NAMESPACES[ACTION_KEYS[ak]]];
        captureEventOnce(akNS && akNS.onClicked, actionClickedListeners[ACTION_KEYS[ak]]);
      }
      captureEventOnce(capNS.commands && capNS.commands.onCommand, commandListeners);
    }

    var LEVELS = ["log", "info", "warn", "error", "debug", "trace"];
    // The dev server's HMR client logs its own chatter ("[HMR] Waiting for
    // update signal from WDS...") through the extension's console; it is not
    // the extension's output. Its warnings and errors still ship.
    function isDevServerChatter(level, args) {
      if (level === "warn" || level === "error") return false;
      var first = args && args[0];
      return typeof first === "string" && /^\\[(?:HMR|webpack-dev-server|rspack-dev-server)\\] /.test(first);
    }
    var socket = null;
    var open = false;
    var queue = [];
    var backoff = 250;
    var MAX_BACKOFF = 5000;
    var connectFailures = 0;
    var MAX_QUEUE = 1000;
    var MAX_RESULT_BYTES = 256 * 1024;
    // Where log frames of every level are parked so a context that dies before
    // its socket opens does not take them along: a Safari background woken by
    // an event can unload before it connects. Capped; plain lines go before
    // errors when the cap bites.
    var PENDING_ERRORS_KEY = "__extjsPendingErrors";
    var MAX_PENDING_ERRORS = 100;
    var PENDING_ERROR_TTL = 300000;

    function nowId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    // The extension's own URL scheme names the engine outright, which beats a
    // user agent where Chrome and Safari both say "Safari".
    function engineName() {
      try {
        var scheme = (typeof location !== "undefined" && location.protocol) || "";
        if (scheme.indexOf("safari-web-extension") === 0) return "webkit";
        if (scheme.indexOf("moz-extension") === 0) return "firefox";
        if (scheme.indexOf("chrome-extension") === 0) return "chromium";
        var ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
        if (/firefox/i.test(ua)) return "firefox";
        if (/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return "webkit";
        return "chromium";
      } catch (e) { return "chromium"; }
    }

    // A cycle cannot cross as JSON. Each repeat of an ancestor becomes null,
    // which is what Chromium answers for a value returned from a tab.
    function cycleSafeJson(v) {
      var stack = [];
      return JSON.stringify(v, function (_key, val) {
        while (stack.length && stack[stack.length - 1] !== this) stack.pop();
        if (typeof val === "bigint") val = {__type: "bigint", value: String(val)};
        if (val && typeof val === "object") {
          if (stack.indexOf(val) !== -1) return null;
          stack.push(val);
        }
        return val;
      });
    }

    function safeValue(v) {
      try {
        var s;
        try { s = JSON.stringify(v); } catch (eCycle) { s = cycleSafeJson(v); }
        if (s === undefined) return {value: undefined, truncated: false};
        if (s.length > MAX_RESULT_BYTES) {
          return {value: {__type: "truncated", preview: s.slice(0, 1024)}, truncated: true};
        }
        return {value: JSON.parse(s), truncated: false};
      } catch (e) {
        return {value: {__type: "unserializable", preview: String(v).slice(0, 512)}, truncated: false};
      }
    }

    // A page cap counts characters, the transport counts the escaped JSON, and
    // markup grows under escaping. Shrink the html until the whole snapshot
    // fits, so a capped inspect still returns html instead of a placeholder.
    function fitSnapshot(snap) {
      try {
        if (!snap || typeof snap.html !== "string") return snap;
        if (JSON.stringify(snap).length <= MAX_RESULT_BYTES) return snap;
        var html = snap.html;
        var cut = html.length;
        for (var attempt = 0; attempt < 40 && cut > 0; attempt++) {
          snap.html = html.slice(0, cut);
          snap.htmlTruncated = true;
          var size = JSON.stringify(snap).length;
          if (size <= MAX_RESULT_BYTES) return snap;
          cut = Math.floor(cut * (MAX_RESULT_BYTES / size) * 0.98);
        }
        snap.html = "";
        snap.htmlTruncated = true;
        return snap;
      } catch (e) {
        return snap;
      }
    }

    function replyOk(cmdId, value) {
      var s = safeValue(value);
      var frame = {type: "result", cmdId: cmdId, ok: true, value: s.value};
      if (s.truncated) frame.truncated = true;
      try { socket && socket.send(JSON.stringify(frame)); } catch (e) {
        // Ignore
      }
    }

    function replyErr(cmdId, name, message, code, hint) {
      var frame = {type: "result", cmdId: cmdId, ok: false, error: {name: name, message: String(message), engine: engineName()}};
      if (code) frame.error.code = code;
      if (hint) frame.error.hint = hint;
      try { socket && socket.send(JSON.stringify(frame)); } catch (e) {
        // Ignore
      }
    }

    // A tabs.* failure the caller can act on gets a name and a refusal code:
    // a tab id nobody has is TargetNotFound, and a url the engine refuses by
    // rule (Gecko's "Illegal URL", Chromium's javascript: ban) is BadRequest.
    // Anything else keeps the op's own error name.
    function replyTabsFailure(cmdId, err, fallbackName, url) {
      var msg = String((err && err.message) || err);
      if (/no tab with id|invalid tab id/i.test(msg)) {
        replyErr(cmdId, "TargetNotFound", msg, "tab_not_found");
        return;
      }
      if (url && /illegal url|javascript urls are not allowed|invalid url/i.test(msg)) {
        replyErr(cmdId, "BadRequest", engineName() + " refuses to open " + url + " from the extension's tabs API (" + msg + ")", "url_refused");
        return;
      }
      replyErr(cmdId, fallbackName, msg);
    }

    // extension open reaches the popup, options and sidebar only. A devtools
    // page runs while DevTools is open on a tab, an override page in its tab.
    // The advice names extension open only where that engine lets it work.
    function surfaceNotOpen(ctx) {
      var engine = engineName();
      var how = "open it first: extension open " + ctx;
      if (engine === "chromium" && (ctx === "popup" || ctx === "sidebar")) {
        how = "open it first: click the extension's toolbar entry, or its row in the extensions menu";
      } else if (engine === "firefox" && ctx === "sidebar") {
        how = "open it first: the sidebar button in the toolbar, or View > Sidebar";
      }
      if (ctx === "devtools") {
        var flag = engine === "firefox" ? "--devtools" : engine === "chromium" ? "--auto-open-devtools-for-tabs" : "";
        how = "the devtools page runs only while DevTools is open on a tab, and extension open cannot open DevTools. Open DevTools on a tab first" + (flag ? ", or start the session with " + flag + " added to EXTENSION_BROWSER_FLAGS" : "");
      } else if (ctx === "newtab" || ctx === "history" || ctx === "bookmarks") {
        how = "open that page in a tab first";
      }
      return {code: "surface_not_open", message: "surface '" + ctx + "' is not open (" + how + ")"};
    }

    // A surface relay that answered nothing is closed only when the engine
    // says no receiver exists. Any other lastError (a reply the engine could
    // not clone, a channel that closed) means the surface WAS open and ran the
    // expression, so the message quotes the engine instead of "not open".
    function surfaceReplyFailure(ctx, resp) {
      var le = null;
      try { le = g.chrome && g.chrome.runtime && g.chrome.runtime.lastError; } catch (e) {
        // Ignore
      }
      if (!le && resp) return null;
      var lem = le ? String((le && le.message) || le) : "";
      if (!lem || /receiving end does not exist|could not establish connection/i.test(lem)) {
        return surfaceNotOpen(ctx);
      }
      return {code: "surface_reply_failed", message: "surface '" + ctx + "' answered but the reply did not arrive: " + lem};
    }

    // Why a tab injection cannot run here. An MV3 copy whose manifest omits
    // the scripting permission has no chrome.scripting (Firefox gates the
    // whole namespace on it); only MV2 lacks the API by design.
    function scriptingMissingReason(tabId) {
      var m = null;
      try { m = g.chrome.runtime.getManifest(); } catch (e) { m = null; }
      var mv = m && m.manifest_version;
      if (mv >= 3) {
        var perms = stringList(m.permissions);
        if (perms.indexOf("scripting") === -1) {
          var gate = engineName() === "firefox" ? " (Firefox exposes it only with that permission)" : "";
          return "cannot inject into tab " + tabId + ": this MV3 build's manifest has no \\"scripting\\" permission, so chrome.scripting is missing" + gate + ". Add \\"scripting\\" to permissions, or use a dev session (extension dev), which adds it; --context background still works";
        }
        return "cannot inject into tab " + tabId + ": chrome.scripting is missing on this engine even though the manifest declares \\"scripting\\"; use --context background";
      }
      if (mv === 2) return "chrome.scripting is not available on this engine (MV2 has no scripting API); use --context background";
      return "cannot inject into tab " + tabId + ": chrome.scripting is not available on this engine; use --context background";
    }

    // A tab id nobody has is a missing target on any build, so the engine is
    // asked for the tab before the missing permission gets the blame.
    function replyScriptingMissing(cmdId, tabId) {
      nsCall("tabs", "get", [tabId], function (err) {
        var msg = String((err && err.message) || err || "");
        if (err && /no tab with id|invalid tab id/i.test(msg)) {
          replyErr(cmdId, "TargetNotFound", msg, "tab_not_found");
          return;
        }
        replyErr(cmdId, "Unsupported", scriptingMissingReason(tabId), "scripting_unavailable");
      });
    }

    function ownPopupIsOpen(cb) {
      try {
        var ext = (g.browser && g.browser.extension) || (g.chrome && g.chrome.extension);
        if (ext && typeof ext.getViews === "function") { cb(ext.getViews({type: "popup"}).length > 0); return; }
      } catch (e) {
        // Ignore
      }
      var rt = g.chrome && g.chrome.runtime;
      if (!rt || typeof rt.getContexts !== "function") { cb(false); return; }
      try {
        Promise.resolve(rt.getContexts({contextTypes: ["POPUP"]})).then(function (list) { cb(!!(list && list.length)); }, function () { cb(false); });
      } catch (e2) { cb(false); }
    }

    // Firefox refuses openPopup while any panel shows. When that panel is this
    // extension's own popup, the caller already has what it asked for.
    function replyOpenPopupFailure(cmdId, err, surface, okValue) {
      var msg = String((err && err.message) || err);
      if (!/another panel is open/i.test(msg)) {
        replyErr(cmdId, "Unsupported", "openPopup: " + msg, openRefusalCode(msg));
        return;
      }
      ownPopupIsOpen(function (open) {
        if (open) { okValue.alreadyOpen = true; replyOk(cmdId, okValue); return; }
        replyErr(cmdId, "Unsupported", "another panel is open in the browser window, and one panel shows at a time (" + msg + ")", "panel_already_open", "Close the open panel, then run extension open " + surface + " again.");
      });
    }

    // The page a surface lives in, as the manifest names it, so the background
    // can ask the engine whether that page is open at all.
    function surfacePagePath(ctx) {
      var m = null;
      try { m = g.chrome.runtime.getManifest(); } catch (e) { return null; }
      if (!m) return null;
      var p = null;
      if (ctx === "popup") p = (m.action && m.action.default_popup) || (m.browser_action && m.browser_action.default_popup) || (m.page_action && m.page_action.default_popup);
      else if (ctx === "options") p = (m.options_ui && m.options_ui.page) || m.options_page;
      else if (ctx === "sidebar") p = (m.side_panel && m.side_panel.default_path) || (m.sidebar_action && m.sidebar_action.default_panel);
      else if (ctx === "devtools") p = m.devtools_page;
      else if (ctx === "newtab" || ctx === "history" || ctx === "bookmarks") p = m.chrome_url_overrides && m.chrome_url_overrides[ctx];
      // Character classes on purpose: this source is a template literal, and
      // a backslash escape in a regex would be eaten before it ever ran.
      return typeof p === "string" && p ? p.replace(/^[.]?[/]/, "") : null;
    }

    function surfaceManifestKeys(ctx) {
      if (ctx === "popup") return "action.default_popup, browser_action.default_popup or page_action.default_popup";
      if (ctx === "options") return "options_ui.page or options_page";
      if (ctx === "sidebar") return "side_panel.default_path or sidebar_action.default_panel";
      if (ctx === "devtools") return "devtools_page";
      return "chrome_url_overrides." + ctx;
    }

    // A surface the manifest never declares has no page to open, so asking
    // the caller to open it first would send them after nothing.
    function surfaceNotDeclared(ctx) {
      var m = null;
      try { m = g.chrome.runtime.getManifest(); } catch (e) { return null; }
      if (!m || surfacePagePath(ctx)) return null;
      return {code: "surface_not_declared", message: "the manifest declares no " + ctx + " page: it has no " + surfaceManifestKeys(ctx)};
    }

    // Chrome says "message port closed" both when the surface died mid-op and
    // when a bystander extension page (the options page, a new tab override)
    // received the message and passed, since a relay returns nothing for a
    // context that is not its own. Only the engine's open-context list tells
    // the two apart, so it is asked before a reply gets the blame. Engines
    // without getContexts keep the plain classification.
    function classifySurfaceFailure(ctx, resp, cb) {
      var relayErr = surfaceReplyFailure(ctx, resp);
      if (!relayErr || relayErr.code !== "surface_reply_failed" || !/message port closed/i.test(relayErr.message)) { cb(relayErr); return; }
      var rt = g.chrome && g.chrome.runtime;
      var page = surfacePagePath(ctx);
      if (!page || !rt || typeof rt.getContexts !== "function") { cb(relayErr); return; }
      var wanted = "";
      try { wanted = String(rt.getURL(page)).split(/[?#]/)[0]; } catch (e) { cb(relayErr); return; }
      var notOpen = surfaceNotOpen(ctx);
      try {
        Promise.resolve(rt.getContexts({})).then(function (list) {
          var open = false;
          for (var i = 0; i < (list || []).length; i++) {
            var u = list[i] && list[i].documentUrl;
            if (u && String(u).split(/[?#]/)[0] === wanted) { open = true; break; }
          }
          cb(open ? relayErr : notOpen);
        }, function () { cb(relayErr); });
      } catch (e) { cb(relayErr); }
    }

    // Every engine's wording for "this document's CSP forbids eval". Gecko
    // says "call to eval() blocked by CSP", Chromium quotes the directive.
    function cspBlocksEval(message) {
      return /call to eval\\(\\)|blocked by (?:the )?CSP|Content Security Policy|unsafe-eval/i.test(String(message == null ? "" : message));
    }

    // Name the refusal the browser wrote as prose, so a consumer branches on
    // error.code instead of matching the engine's sentence.
    function openRefusalCode(message) {
      var m = String(message == null ? "" : message);
      if (/user gesture|user input|user interaction|user action/i.test(m)) return "needs_user_gesture";
      if (/browser window|active window/i.test(m)) return "needs_headed_window";
      return undefined;
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
              ownPageMatch();
            });
          } catch (e2) { cb(null, "tab query failed"); }
        };
        // Without the tabs permission Chromium hides every tab's url, the
        // extension's own pages included, so those are found by their context.
        var noMatch = function () {
          var perms = null;
          try { perms = stringList(chrome.runtime.getManifest().permissions); } catch (e4) { perms = null; }
          var hidden = !!perms && perms.indexOf("tabs") === -1;
          cb(null, "no open tab matches url: " + url + (hidden ? ". This build's manifest has no \\"tabs\\" permission, so the browser hides the url of a tab the extension has no host access to; pass --tab <id>, or use a dev session (extension dev), which adds the permission" : ""));
        };
        var ownPageMatch = function () {
          var rt = chrome.runtime;
          if (!rt || typeof rt.getContexts !== "function") { noMatch(); return; }
          try {
            Promise.resolve(rt.getContexts({contextTypes: ["TAB"]})).then(function (list) {
              var own = (list || []).filter(function (c) { return typeof c.tabId === "number" && c.tabId >= 0 && c.documentUrl && String(c.documentUrl).indexOf(url) !== -1; })[0];
              if (own) { cb(own.tabId, null); return; }
              noMatch();
            }, noMatch);
          } catch (e5) { noMatch(); }
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

    // Only a tab the engine could not find is a missing target. Anything else
    // happened in a tab that exists, a value it could not clone back above all.
    // Firefox refuses to script a moz-extension:// page or a page outside
    // host access with the tab right there, so that refusal is named too.
    function injectionErrorName(err) {
      var msg = String((err && err.message) || err || "");
      if (/no tab with id|invalid tab id/i.test(msg)) return "TargetNotFound";
      if (/clon/i.test(msg)) return "DataCloneError";
      if (injectionRefused(msg)) return "InjectionRefused";
      return "ExecutorError";
    }

    function injectionRefused(msg) {
      return /missing host permission|cannot access contents|cannot be scripted|cannot access a chrome|extensions gallery/i.test(String(msg));
    }

    function replyInjectionErr(cmdId, err) {
      var msg = (err && err.message) || err;
      var name = injectionErrorName(err);
      replyErr(cmdId, name, msg, injectionRefused(msg) ? "injection_refused" : name === "TargetNotFound" ? "tab_not_found" : undefined);
    }

    function executeCommand(cmd) {
      var op = cmd.op, target = cmd.target || {}, args = cmd.args || {};
      var ctx = target.context || "background";
      var chrome = g.chrome;
      var cmdId = cmd.cmdId;
      // content/page eval & inspect need a numeric tab id: resolve --url (or
      // nothing) to a tab and re-dispatch with target.tabId filled in. (#51)
      if ((op === "eval" || op === "inspect" || op === "reload") && (ctx === "content" || ctx === "page") && target.tabId == null) {
        resolveTargetTab(target, function (tabId, err) {
          if (tabId == null) {
            // A filter that matched nothing, or no active tab, is a missing
            // target the caller can fix, not a missing feature.
            if (err && /^no open tab matches|^no active tab/i.test(String(err))) {
              replyErr(cmdId, "TargetNotFound", err, "tab_not_found");
              return;
            }
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
                // rejects 'unsafe-eval'. Gecko words the same refusal "call to
                // eval() blocked by CSP", which read as a guest throw.
                if (cspBlocksEval(msg)) {
                  replyErr(cmdId, "Unsupported", "eval is blocked in the extension background by the extension's content_security_policy, which allows no unsafe-eval. Use --context page --tab <id> (eval runs in the page's MAIN world), or run on a build whose CSP permits it. Engine: " + engineName(), "csp_blocks_eval");
                } else {
                  replyErr(cmdId, (e && e.name) || "EvalError", msg);
                }
              });
          } else if ((ctx === "content" || ctx === "page") && target.tabId && chrome.scripting) {
            // Wrap the eval so a throw INSIDE the tab comes back as data:
            // Chrome swallows an injected function's exception (null result).
            // A returned promise is settled in the tab, since Firefox cannot
            // clone one that sits inside the result object.
            nsCall("scripting", "executeScript", [{
              target: {tabId: target.tabId},
              world: ctx === "page" ? "MAIN" : "ISOLATED",
              func: async function (src) {
                // Firefox refuses to clone a cycle or a DOM node out of a tab and
                // Chromium nulls them, so the value takes its JSON form in the tab.
                function __extjsJsonForm(v) {
                  var stack = [];
                  try {
                    var json = JSON.stringify(v, function (_key, val) {
                      while (stack.length && stack[stack.length - 1] !== this) stack.pop();
                      if (typeof val === "bigint") val = {__type: "bigint", value: String(val)};
                      if (val && typeof val === "object") {
                        if (stack.indexOf(val) !== -1) return null;
                        stack.push(val);
                      }
                      return val;
                    });
                    return json === undefined ? undefined : JSON.parse(json);
                  } catch (e) { return v; }
                }
                try { return {__extjsEval: 1, ok: true, value: __extjsJsonForm(await eval(src))}; }
                catch (e) { return {__extjsEval: 1, ok: false, name: (e && e.name) || "EvalError", message: (e && e.message) || String(e)}; }
              },
              args: [String(args.expression)]
            }], function (err, res) {
              if (err) { replyInjectionErr(cmdId, err); return; }
              var frame = res && res[0] ? res[0].result : undefined;
              if (!frame || frame.__extjsEval !== 1) {
                replyErr(cmdId, "TargetNotFound", "the expression never executed in tab " + target.tabId + ": no injectable frame returned a result (restricted page, or outside host_permissions)");
                return;
              }
              if (frame.ok) { replyOk(cmdId, frame.value); return; }
              if (ctx === "content" && (cspBlocksEval(String(frame.name) + " " + String(frame.message)) || String(frame.name) === "EvalError")) {
                replyErr(cmdId, "Unsupported", "eval of a string is blocked in the ISOLATED (content) world by the extension's content_security_policy. Use --context page (runs in the page's MAIN world). Original: " + frame.message, "csp_blocks_eval");
                return;
              }
              replyErr(cmdId, frame.name || "EvalError", frame.message);
            });
          } else if (ctx === "popup" || ctx === "options" || ctx === "sidebar" || ctx === "devtools" || ctx === "newtab" || ctx === "history" || ctx === "bookmarks") {
            var evalUndeclared = surfaceNotDeclared(ctx);
            if (evalUndeclared) { replyErr(cmdId, "Unsupported", evalUndeclared.message, evalUndeclared.code); return; }
            // The SW can't eval in another extension page; ask the surface's
            // own in-bundle relay (only the open, matching-context page responds).
            chrome.runtime.sendMessage(
              {__extjsEvalRequest: true, target: target, args: {expression: String(args.expression)}},
              function (resp) {
                classifySurfaceFailure(ctx, resp, function (relayErr) {
                  if (relayErr) {
                    replyErr(cmdId, "Unsupported", relayErr.message, relayErr.code);
                  } else if (resp.ok) {
                    replyOk(cmdId, resp.value);
                  } else {
                    replyErr(cmdId, (resp.error && resp.error.name) || "EvalError", (resp.error && resp.error.message) || "eval failed", resp.error && resp.error.code);
                  }
                });
              }
            );
          } else if (ctx === "content" || ctx === "page") {
            if (target.tabId) replyScriptingMissing(cmdId, target.tabId);
            else replyErr(cmdId, "Unsupported", "eval in context " + ctx + " requires a tabId");
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
          // The dev runtime keeps its own bookkeeping under __extjs* keys in
          // the same area; a whole-area read shows only the extension's data.
          var withoutFrameworkKeys = function (r) {
            if (args.key != null || !r || typeof r !== "object") return r;
            var own = {};
            for (var k in r) {
              if (Object.prototype.hasOwnProperty.call(r, k) && k.indexOf("__extjs") !== 0) own[k] = r[k];
            }
            return own;
          };
          var onStorageOk = function (r) { replyOk(cmdId, isSet ? {set: Object.keys(args.items || {})} : withoutFrameworkKeys(r)); };
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
            // The answer names the override tabs the next generation restores.
            restartExtension(50, function (restoring) {
              var value = {reloading: true, reloaded: ["background"]};
              if (restoring.length) {
                value.restoring = [];
                for (var r = 0; r < restoring.length; r++) value.restoring.push({tabId: restoring[r].tabId, surface: restoring[r].surface});
              }
              replyOk(cmdId, value);
            });
          } else if (target.tabId) {
            nsCall("tabs", "reload", [target.tabId], function (err) {
              if (err) replyTabsFailure(cmdId, err, "ReloadError");
              else replyOk(cmdId, {reloaded: target.tabId});
            });
          } else {
            replyErr(cmdId, "Unsupported", "reload needs background or a tabId");
          }
          return;
        }
        if (op === "open") {
          var surface = args.surface || ctx;
          // The toolbar entry a click lands on: MV3 declares action, MV2
          // browser_action or page_action. Firefox MV3 still exposes
          // pageAction, so the manifest picks first, and its namespace has to
          // exist. Without a declared key, the first namespace present wins.
          var actionManifestKey = function () {
            var m = null;
            try { m = chrome.runtime.getManifest(); } catch (e) { m = null; }
            var hasNS = function (key) {
              var n = ACTION_NAMESPACES[key];
              return !!((g.browser && g.browser[n]) || (g.chrome && g.chrome[n]));
            };
            for (var k = 0; k < ACTION_KEYS.length; k++) {
              if (m && m[ACTION_KEYS[k]] && hasNS(ACTION_KEYS[k])) return ACTION_KEYS[k];
            }
            for (var n = 0; n < ACTION_KEYS.length; n++) {
              if (hasNS(ACTION_KEYS[n])) return ACTION_KEYS[n];
            }
            return null;
          };
          // A page action's popup is per tab, and both engines require the
          // tabId. Always resolves to a string.
          var getActionPopup = function (key, tab, cb) {
            var details = key === "page_action" ? {tabId: tab && tab.id} : {};
            nsCall(ACTION_NAMESPACES[key], "getPopup", [details], function (err, p) {
              cb(err ? "" : (p || ""));
            });
          };
          var resolveActiveTab = function (a, cb) {
            if (a && typeof a.tabId === "number") {
              try { chrome.tabs.get(a.tabId, function (t) { cb(t || {id: a.tabId}); }); return; }
              catch (e) {
                // Ignore
              }
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
            } catch (e) {
              // Ignore
            }
            return null;
          };
          if (surface === "popup") {
            var popupKey = actionManifestKey();
            var popupNS = popupKey && ACTION_NAMESPACES[popupKey];
            if (popupNS && chrome[popupNS] && chrome[popupNS].openPopup) {
              nsCall(popupNS, "openPopup", [], function (err) {
                if (err) replyOpenPopupFailure(cmdId, err, "popup", {opened: "popup"});
                else replyOk(cmdId, {opened: "popup"});
              });
            } else { replyErr(cmdId, "Unsupported", (popupNS || "action") + ".openPopup not available", "api_unavailable"); }
          } else if (surface === "options") {
            // Chrome answers a manifest with no options page through lastError
            // and still calls back, so the callback must read it.
            try {
              chrome.runtime.openOptionsPage(function () {
                var optErr = chrome.runtime.lastError;
                if (optErr) {
                  replyErr(cmdId, "Unsupported", "openOptionsPage: " + (optErr.message || optErr) + " (the manifest declares no options_ui or options_page)", "surface_not_declared");
                } else replyOk(cmdId, {opened: "options"});
              });
            }
            catch (e) { replyErr(cmdId, "Unsupported", "openOptionsPage: " + e); }
          } else if (surface === "sidebar") {
            // The two member reads below are exactly what the Safari
            // unsupported-API scan looks for, and this runtime is prepended to
            // the background asset at PROCESS_ASSETS_STAGE_REPORT + 101, after
            // that scan runs at SUMMARIZE + 1. Move the injection earlier and
            // every Safari dev session warns about this line.
            if (chrome.sidePanel && chrome.sidePanel.open && chrome.windows) {
              chrome.windows.getCurrent(function (w) {
                nsCall("sidePanel", "open", [{windowId: w.id}], function (err) {
                  if (err) {
                    var sideMsg = (err && err.message) || err;
                    replyErr(cmdId, "Unsupported", "sidePanel.open: " + sideMsg, openRefusalCode(sideMsg));
                  } else replyOk(cmdId, {opened: "sidebar"});
                });
              });
            } else if (engineName() === "firefox") {
              // Firefox has no side panel API, and its sidebar opens only inside
              // a user action handler, which a bridge command is not.
              replyErr(cmdId, "Unsupported", "the sidebar comes from sidebar_action here and opens only on a user action, so the CLI cannot open it", "api_unavailable", "Open it from the Firefox sidebar button, or View > Sidebar. Once it is open, extension eval --context sidebar and extension inspect --context sidebar reach it.");
            } else { replyErr(cmdId, "Unsupported", "sidePanel is not available", "api_unavailable"); }
          } else if (surface === "action") {
            // With a popup the click opens it; without one, replay the
            // onClicked listeners captured at install time. The answer names
            // the manifest key the click went through.
            var actionKey = actionManifestKey();
            if (actionKey) {
              var actionNS = ACTION_NAMESPACES[actionKey];
              var clicked = actionClickedListeners[actionKey];
              resolveActiveTab(args, function (tab) {
                getActionPopup(actionKey, tab, function (popup) {
                  if (popup) {
                    nsCall(actionNS, "openPopup", [], function (err) {
                      if (err) replyOpenPopupFailure(cmdId, err, "action", {triggered: "popup", manifestKey: actionKey});
                      else replyOk(cmdId, {triggered: "popup", manifestKey: actionKey});
                    });
                  } else if (clicked.length) {
                    var fired = 0;
                    for (var i = 0; i < clicked.length; i++) {
                      try { clicked[i](tab); fired++; } catch (e) {
                        // Ignore
                      }
                    }
                    var reply = {triggered: "onClicked", listeners: fired, gesture: false, manifestKey: actionKey};
                    var warning = activeTabWarning();
                    if (warning) reply.warning = warning;
                    replyOk(cmdId, reply);
                  } else {
                    replyErr(cmdId, "Unsupported", actionKey + " has no popup and no " + actionNS + ".onClicked listener registered");
                  }
                });
              });
            } else { replyErr(cmdId, "Unsupported", "the manifest declares no action, browser_action or page_action", "surface_not_declared"); }
          } else if (surface === "command") {
            var commandName = (args && args.name) || undefined;
            if (!commandListeners.length) {
              replyErr(cmdId, "Unsupported", "no chrome.commands.onCommand listener registered");
            } else {
              resolveActiveTab(args, function (tab) {
                var fired = 0;
                for (var i = 0; i < commandListeners.length; i++) {
                  try { commandListeners[i](commandName, tab); fired++; } catch (e) {
                    // Ignore
                  }
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
            var rows = (tabs || []).map(function (t) { return {id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId}; });
            var rt = chrome.runtime;
            var hiddenUrl = rows.some(function (row) { return !row.url; });
            if (!hiddenUrl || !rt || typeof rt.getContexts !== "function") { replyOk(cmdId, rows); return; }
            // Chromium hides a tab's url without the tabs permission. The
            // extension's own pages still name theirs through their context.
            try {
              Promise.resolve(rt.getContexts({contextTypes: ["TAB"]})).then(function (list) {
                var own = {};
                (list || []).forEach(function (c) { if (typeof c.tabId === "number" && c.tabId >= 0 && c.documentUrl) own[c.tabId] = String(c.documentUrl); });
                rows.forEach(function (row) { if (!row.url && own[row.id]) row.url = own[row.id]; });
                replyOk(cmdId, rows);
              }, function () { replyOk(cmdId, rows); });
            } catch (eCtx) { replyOk(cmdId, rows); }
          });
          return;
        }
        // Navigation is a static tabs.* call, never an eval: an MV3 background
        // (Safari's included) refuses eval by CSP, so a url must reach a tab
        // through code that shipped with the bridge. A tabId targets that
        // tab, newTab opens one, and otherwise the active tab is reused.
        if (op === "tabs.navigate") {
          var navUrl = typeof args.url === "string" ? args.url : "";
          if (!navUrl) { replyErr(cmdId, "BadRequest", "tabs.navigate needs a url"); return; }
          var navDone = function (err, tab, created) {
            if (err) { replyTabsFailure(cmdId, err, "TabsError", navUrl); return; }
            replyOk(cmdId, {tabId: tab && tab.id != null ? tab.id : null, url: navUrl, created: !!created});
          };
          if (target.tabId != null) {
            nsCall("tabs", "update", [target.tabId, {url: navUrl}], function (err, tab) { navDone(err, tab, false); });
            return;
          }
          if (args.newTab) {
            nsCall("tabs", "create", [{url: navUrl, active: args.active !== false}], function (err, tab) { navDone(err, tab, true); });
            return;
          }
          nsCall("tabs", "query", [{active: true, currentWindow: true}], function (qErr, tabs) {
            var active = !qErr && tabs && tabs[0];
            if (active && active.id != null) {
              nsCall("tabs", "update", [active.id, {url: navUrl}], function (err, tab) { navDone(err, tab, false); });
            } else {
              nsCall("tabs", "create", [{url: navUrl}], function (err, tab) { navDone(err, tab, true); });
            }
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
              if (err) { replyInjectionErr(cmdId, err); return; }
              var snap = res && res[0] ? res[0].result : undefined;
              if (snap == null) { replyErr(cmdId, "TargetNotFound", "no injectable frame returned a snapshot for tab " + target.tabId + " (restricted page, or outside host_permissions)"); return; }
              replyOk(cmdId, fitSnapshot(snap));
            });
          } else if (ctx === "popup" || ctx === "options" || ctx === "sidebar" || ctx === "devtools" || ctx === "newtab" || ctx === "history" || ctx === "bookmarks") {
            var inspectUndeclared = surfaceNotDeclared(ctx);
            if (inspectUndeclared) { replyErr(cmdId, "Unsupported", inspectUndeclared.message, inspectUndeclared.code); return; }
            // The SW can't read a surface page's DOM; ask the surface's own
            // in-bundle relay (only the open, matching-context page responds).
            chrome.runtime.sendMessage(
              {__extjsInspectRequest: true, target: target, args: args},
              function (resp) {
                classifySurfaceFailure(ctx, resp, function (relayErr) {
                  if (relayErr) {
                    replyErr(cmdId, "Unsupported", relayErr.message, relayErr.code);
                  } else if (resp.ok) {
                    replyOk(cmdId, fitSnapshot(resp.value));
                  } else {
                    replyErr(cmdId, (resp.error && resp.error.name) || "InspectError", (resp.error && resp.error.message) || "inspect failed");
                  }
                });
              }
            );
          } else if ((ctx === "content" || ctx === "page") && target.tabId) {
            replyScriptingMissing(cmdId, target.tabId);
          } else if (ctx === "background") {
            replyErr(cmdId, "Unsupported", (engineName() === "chromium" ? "the service worker has no DOM" : "the background has no page to read") + "; inspect a content/page (with --tab) or an open surface");
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

    function noopLastError() { try { void g.chrome.runtime.lastError; } catch (e) {
      // Ignore
    } }

    // Only http(s)/file/ftp tabs can run a content script; skip chrome://, the
    // extension's own pages, about:blank, etc.
    function isInjectableUrl(url) {
      return typeof url === "string" && /^(https?|file|ftp):/i.test(url);
    }

    function stringList(value) {
      return Array.isArray(value) ? value.filter(function (v) { return typeof v === "string"; }) : [];
    }

`

const PRODUCER_MIDDLE = `    function sanitize(args) {
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

    // While an earlier context's parked lines replay, this context's own
    // frames wait in the queue so the agent reads them in the order written.
    var replaying = false;

    function flush() {
      while (queue.length && open && socket && !replaying) {
        var f = queue.shift();
        try { socket.send(JSON.stringify(f)); } catch (e) { break; }
      }
    }

    function send(frame) {
      if (open && socket && !replaying) {
        try { socket.send(JSON.stringify(frame)); return; } catch (e) {
          // Ignore
        }
      }
      if (queue.length < MAX_QUEUE) queue.push(frame);
      parkPendingError(frame);
    }

    // The queue above lives in this context's memory only, so a background
    // that throws while it evaluates dies with the error still queued: the
    // socket has not finished its handshake yet. Park log frames in extension
    // storage too, where the NEXT context to connect can ship them.
    // Best effort by construction: the write is asynchronous, so a teardown
    // can cut it before the browser records anything.
    var parkedErrors = [];
    // What an earlier context parked and this one has not shipped yet. Null
    // until read: the key is rewritten whole, so a write before the read
    // would erase the lines a background that just unloaded left behind.
    var inheritedParked = null;
    function storageLocalArea() {
      try {
        var ns = (g.chrome && g.chrome.storage) || (g.browser && g.browser.storage);
        var area = ns && ns.local;
        if (!area || typeof area.get !== "function" || typeof area.set !== "function") return null;
        return area;
      } catch (e) { return null; }
    }
    function trimParked(list) {
      while (list.length > MAX_PENDING_ERRORS) {
        var dropped = false;
        for (var i = 0; i < list.length; i++) {
          var ev = list[i] && list[i].event;
          if (!ev || ev.level !== "error") { list.splice(i, 1); dropped = true; break; }
        }
        if (!dropped) list.shift();
      }
      return list;
    }
    function parkedHere(id) {
      for (var i = 0; i < parkedErrors.length; i++) {
        var ev = parkedErrors[i] && parkedErrors[i].event;
        if (ev && ev.id === id) return true;
      }
      return false;
    }
    function replayable(frame) {
      var ev = frame && frame.event;
      if (!ev) return false;
      // A background that died before it read its session parked no run id.
      if (ev.runId !== INSTANCE_ID && !(SESSION_FROM_FILE && ev.runId === "")) return false;
      if (parkedHere(ev.id)) return false;
      return typeof ev.timestamp === "number" && Date.now() - ev.timestamp <= PENDING_ERROR_TTL;
    }
    // The whole list is rewritten on every park, so two lines in one turn
    // cannot lose each other to a read-modify-write, and the cap holds.
    function writeParked() {
      if (inheritedParked === null) return;
      var area = storageLocalArea();
      if (!area) return;
      var items = {};
      items[PENDING_ERRORS_KEY] = trimParked(inheritedParked.concat(parkedErrors));
      try { area.set(items, noopLastError); } catch (e) {
        // Ignore
      }
    }
    function parkPendingError(frame) {
      if (open) return;
      if (!frame || frame.type !== "log" || !frame.event) return;
      if (!storageLocalArea()) return;
      parkedErrors.push(frame);
      trimParked(parkedErrors);
      writeParked();
    }
    function readParked(area, onList) {
      var read = false;
      function onRead(res) {
        if (read) return;
        read = true;
        var list = res && res[PENDING_ERRORS_KEY];
        onList(Array.isArray(list) ? list : []);
      }
      try {
        var ret = area.get(PENDING_ERRORS_KEY, function (res) { noopLastError(); onRead(res); });
        if (ret && typeof ret.then === "function") ret.then(onRead, function () { onRead(null); });
      } catch (e) {
        onRead(null);
      }
    }
    function adoptInheritedParked() {
      var area = storageLocalArea();
      if (!area) { inheritedParked = []; return; }
      readParked(area, function (list) {
        if (inheritedParked !== null) return;
        inheritedParked = [];
        // Before the session is read nothing can be told apart yet, and the
        // lines are filtered again when they are shipped.
        for (var i = 0; i < list.length; i++) {
          if (!INSTANCE_ID || replayable(list[i])) inheritedParked.push(list[i]);
        }
        if (parkedErrors.length && !open) writeParked();
      });
    }
    // Ship what an earlier context parked and never got to send. Entries from
    // another build (a different instance id) or from an older run are dropped,
    // and the key is cleared on read so one failure is reported once. They
    // were written before anything this context queued, so they go first and
    // straight to the socket; done() then releases this context's own queue.
    var PENDING_READ_TIMEOUT = 1000;
    function flushPendingErrors(done) {
      var area = storageLocalArea();
      if (!area) { done(); return; }
      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        done();
      }
      try {
        setTimeout(finish, PENDING_READ_TIMEOUT);
      } catch (e) {
        // Ignore
      }
      readParked(area, function (list) {
        if (finished) return;
        if (list.length) {
          try {
            if (typeof area.remove === "function") area.remove(PENDING_ERRORS_KEY, noopLastError);
          } catch (e) {
            // Ignore
          }
        }
        var earlier = [];
        for (var i = 0; i < list.length; i++) {
          if (replayable(list[i])) earlier.push(list[i]);
        }
        // Shipped or queued from here on, so nothing parked so far may be
        // written back for a later context to report twice.
        inheritedParked = [];
        parkedErrors = [];
        if (open && socket) {
          for (var j = 0; j < earlier.length; j++) {
            try { socket.send(JSON.stringify(earlier[j])); } catch (e) {
              // Ignore
            }
          }
        } else {
          queue = earlier.concat(queue).slice(0, MAX_QUEUE);
        }
        finish();
      });
    }

    // The baked PORT is a snapshot of an ephemeral port. After a dev-server
    // restart, the port file shipped in the unpacked extension names the
    // live one, and unpacked resources are read from disk on every fetch.
    // Lines logged before the session was read get its id once it is known.
    function adoptSession(id) {
      if (!SESSION_FROM_FILE || typeof id !== "string" || !id || id === INSTANCE_ID) return;
      INSTANCE_ID = id;
      var lists = [queue, parkedErrors];
      for (var l = 0; l < lists.length; l++) {
        for (var i = 0; i < lists[l].length; i++) {
          var ev = lists[l][i] && lists[l][i].event;
          if (ev && ev.runId === "") ev.runId = id;
        }
      }
      if (parkedErrors.length && !open) writeParked();
    }

    function refreshControlPort(done) {
      try {
        var runtime = (g.chrome && g.chrome.runtime) || (g.browser && g.browser.runtime);
        if (!runtime || typeof runtime.getURL !== "function" || typeof g.fetch !== "function") { done(); return; }
        g.fetch(runtime.getURL("extension-js-control.json"), {cache: "no-store"})
          .then(function (res) { return res.json(); })
          .then(function (data) {
            var next = data && parseInt(data.port, 10);
            if (next && next > 0 && next < 65536 && next !== PORT) PORT = next;
            adoptSession(data && data.instanceId);
            done();
          })
          .catch(function () { done(); });
      } catch (e) { done(); }
    }

    function sessionKnown() {
      return !SESSION_FROM_FILE || (!!INSTANCE_ID && PORT > 0);
    }

    // The session file is there before the browser starts, so a read that
    // found none is retried like a server that is not listening yet.
    function dial() {
      if (sessionKnown()) connect();
      else schedule();
    }

    function schedule() {
      var delay = backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
      connectFailures++;
      try {
        setTimeout(function () {
          // Two straight failures make the baked port suspect (a restarted
          // server dials out on a new port): re-resolve before re-dialing.
          if (connectFailures >= 2 || !sessionKnown()) refreshControlPort(dial);
          else dial();
        }, delay);
      } catch (e) {
        // Ignore
      }
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
        connectFailures = 0;
        try {
          socket.send(JSON.stringify({type: "hello", v: 1, role: "producer", instanceId: INSTANCE_ID, acksReloads: true, build: g.__extjsDevBuild}));
        } catch (e) {
          // Ignore
        }
        // Hello goes first, then whatever a previous context parked before it
        // died, then this context's own queue.
        replaying = true;
        flushPendingErrors(function () {
          replaying = false;
          flush();
        });
      };
      socket.onmessage = function (ev) {
        var frame;
        try { frame = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch (e) { return; }
        if (frame && frame.type === "command") {
          try { executeCommand(frame); } catch (e) { replyErr(frame.cmdId, "ExecutorError", e); }
        } else if (frame && frame.type === "reload") {
          // Dev-loop reload broadcast (see broker.broadcastReload).
          // Fire-and-forget: no result frame is expected.
          try { handleDevReloadFrame(frame); } catch (e) {
            // Ignore
          }
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
        try { socket && socket.close(); } catch (e) {
          // Ignore
        }
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
          if (!isDevServerChatter(level, arguments)) send({
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
        } catch (e) {
          // Ignore
        }
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
      } catch (e) {
        // Ignore
      }
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
    } catch (e) {
      // Ignore
    }

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
      } catch (e) {
        // Ignore
      }
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
          } catch (e) {
            // Ignore
          }
        });
      }
    } catch (e) {
      // Ignore
    }
    // sendMessage path: how the devtools page relays, since its port would be
    // mistaken for the extension's own devtools connection. Also accepts any
    // surface still relaying the old way.
    try {
      var rt = g.chrome;
      if (rt && rt.runtime && rt.runtime.onMessage) {
        rt.runtime.onMessage.addListener(function (msg, sender) {
          if (!msg || !msg.__extjsBridgeLog) return;
          shipRelayedLog(msg.__extjsBridgeLog, sender);
        });
      }
    } catch (e) {
      // Ignore
    }

`

const PRODUCER_TAIL = `    adoptInheritedParked();
    if (SESSION_FROM_FILE) refreshControlPort(dial);
    else connect();
  } catch (e) {
    // Ignore
  }
})();
`

export interface ProducerExecutor {
  // Declarations the reload frame and the reload verb call.
  handlers: string
  // Statements that run once as the background starts.
  boot: string
}

export function composeBridgeProducer(executor?: ProducerExecutor): string {
  return (
    PRODUCER_HEAD +
    (executor?.handlers ?? '') +
    PRODUCER_MIDDLE +
    (executor?.boot ?? '') +
    PRODUCER_TAIL
  )
}

export const BRIDGE_PRODUCER_SOURCE = composeBridgeProducer()

// Lightweight console RELAY for non-SW contexts: forwards each call to the SW
// over a NAMED runtime.Port so the extension's own onMessage never loops on it.
// The devtools page is the exception and sends messages, see postLog below.
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
    // Same filter as the producer: HMR chatter is not the page's output.
    function isDevServerChatter(level, args) {
      if (level === "warn" || level === "error") return false;
      var first = args && args[0];
      return typeof first === "string" && /^\\[(?:HMR|webpack-dev-server|rspack-dev-server)\\] /.test(first);
    }

    // Every engine's wording for "this document's CSP forbids eval". Gecko
    // says "call to eval() blocked by CSP", Chromium quotes the directive.
    function cspBlocksEval(message) {
      return /call to eval\\(\\)|blocked by (?:the )?CSP|Content Security Policy|unsafe-eval/i.test(String(message == null ? "" : message));
    }

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

    // The devtools page is the one surface whose port carries no sender.tab,
    // which is how a devtools extension recognizes its own devtools connection.
    // Ours would arrive first and be taken for it, so that surface sends
    // messages instead and the extension's port topology matches production.
    var relayOverPort = canRelay && CONTEXT !== "devtools";
    var canSend = typeof chrome.runtime.sendMessage === "function";

    function sendLog(payload) {
      if (!canSend) return;
      try {
        chrome.runtime.sendMessage({__extjsBridgeLog: payload}, function () {
          try { void chrome.runtime.lastError; } catch (e) {
            // Ignore
          }
        });
      } catch (e) {
        // Ignore
      }
    }

    // Lazy named port to the SW producer: connecting wakes an idle SW, but
    // port frames never reach the extension's own onMessage listeners.
    var logPort = null;
    function getLogPort() {
      if (!relayOverPort) return null;
      if (logPort) return logPort;
      try {
        logPort = chrome.runtime.connect({name: "__extjs-bridge-log__"});
        logPort.onDisconnect.addListener(function () {
          try { void chrome.runtime.lastError; } catch (e) {
            // Ignore
          }
          logPort = null;
        });
      } catch (e) { logPort = null; }
      return logPort;
    }

    // Relay one log payload to the SW producer over the named port, redialing
    // once if the port went stale (SW restarted).
    function postLog(payload) {
      if (!relayOverPort) return sendLog(payload);

      var p = getLogPort();
      if (!p) return;
      try {
        p.postMessage({__extjsBridgeLog: payload});
      } catch (e) {
        logPort = null;
        var p2 = getLogPort();
        if (p2) { try { p2.postMessage({__extjsBridgeLog: payload}); } catch (e2) {
          // Ignore
        } }
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
          if (!isDevServerChatter(level, arguments)) postLog({level: level, context: CONTEXT, messageParts: sanitize([].slice.call(arguments)), url: here()});
        } catch (e) {
          // Ignore
        }
        return orig.apply(consoleRef, arguments);
      };
    });

    function shipUncaughtError(message, stack, url) {
      try {
        var sig = errorSig(message, stack);
        if (errorSigSeenRecently(sig)) return;
        noteErrorSig(sig);
        postLog({level: "error", context: CONTEXT, messageParts: sanitize([String(message) + (stack ? "\\n" + stack : "")]), url: url || here()});
      } catch (e) {
        // Ignore
      }
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
    } catch (e) {
      // Ignore
    }

    // The SW executor can't reach another extension page's DOM or eval there,
    // so THIS surface answers inspect/eval requests for its own context.
    try {
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
          if (!msg || !msg.__extjsEvalRequest) return;
          if (!msg.target || msg.target.context !== CONTEXT) return; // not for me
          // The reply crosses as JSON on Chromium and as a clone on Firefox.
          // Its JSON form, with each cycle nulled, reads the same on both.
          var jsonForm = function (v) {
            var stack = [];
            try {
              var json = JSON.stringify(v, function (_key, val) {
                while (stack.length && stack[stack.length - 1] !== this) stack.pop();
                if (typeof val === "bigint") val = {__type: "bigint", value: String(val)};
                if (val && typeof val === "object") {
                  if (stack.indexOf(val) !== -1) return null;
                  stack.push(val);
                }
                return val;
              });
              return json === undefined ? undefined : JSON.parse(json);
            } catch (e) { return v; }
          };
          var respondValue = function (value) {
            try { sendResponse({ok: true, value: jsonForm(value)}); }
            catch (eSend) { sendResponse({ok: true, value: String(value)}); }
          };
          var respondError = function (e) {
            var emsg = (e && e.message) || String(e);
            if (cspBlocksEval(emsg)) {
              sendResponse({ok: false, error: {name: "Unsupported", code: "csp_blocks_eval", message: "eval of a string is blocked in the " + CONTEXT + " page by the extension's content_security_policy. Use extension inspect --context " + CONTEXT + " to read its DOM instead. Original: " + emsg}});
            } else {
              sendResponse({ok: false, error: {name: (e && e.name) || "EvalError", message: emsg}});
            }
          };
          try {
            var value = (0, eval)(String((msg.args && msg.args.expression) || ""));
            // A promise is not structured-cloneable: Chrome throws on the reply
            // and Firefox drops it on the way out, which the background read as
            // "surface is not open" while the page kept running the expression.
            // Settle it first, the way the background eval already does.
            if (value && typeof value.then === "function") {
              value.then(respondValue, respondError);
            } else {
              respondValue(value);
            }
          } catch (e) {
            respondError(e);
          }
          return true; // responded, possibly later
        });
      }
    } catch (e) {
      // Ignore
    }

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
    } catch (e) {
      // Ignore
    }
  } catch (e) {
    // Ignore
  }
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
  // The producer reads the port and the instance id from the control file
  // of the dist as it starts, and its source names neither.
  sessionFromFile?: boolean
  context?: string
  host?: string
  // What runs a dev reload in the background. The bridge only carries it.
  executor?: ProducerExecutor
}

// Bake the control port / instanceId / context / host into the producer source.
// Returns '' when the control bridge is unavailable (no port).
export function buildBridgeProducerSource(opts: BuildProducerOptions): string {
  if (!opts.controlPort || opts.controlPort < 1) return ''

  const fromFile = opts.sessionFromFile === true

  return composeBridgeProducer(opts.executor)
    .replace(
      /__EXTJS_CONTROL_PORT__/g,
      fromFile ? '0' : String(opts.controlPort)
    )
    .replace(/__EXTJS_INSTANCE_ID__/g, fromFile ? '' : String(opts.instanceId))
    .replace(/__EXTJS_SESSION_FROM_FILE__/g, fromFile ? '1' : '0')
    .replace(/__EXTJS_CONTEXT__/g, String(opts.context || 'background'))
    .replace(/__EXTJS_CONTROL_HOST__/g, String(opts.host || '127.0.0.1'))
}
