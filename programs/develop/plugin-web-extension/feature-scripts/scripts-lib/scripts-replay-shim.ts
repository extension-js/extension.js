// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

/**
 * Dev-only banner prepended to the background service worker / script. Wraps
 * `chrome.scripting.executeScript` so the SDK can replay the same programmatic
 * injections after a user edits a file in `/scripts/*`.
 *
 * Without this, editing `/scripts/script-one.js` rebuilds the bundle on disk
 * but the previously-injected DOM stays stale until the user manually
 * re-triggers whatever called `executeScript`. With this shim plus the
 * controller-side trigger, `/scripts/*` edits behave like declarative
 * `content_scripts` edits: the SDK re-executes the same injection on the
 * same tab, and the wrapper around each `/scripts/<name>.js` (which runs
 * via `__EXTENSIONJS_mount`) handles old-mount teardown.
 *
 * Storage: in-memory `Map` keyed by tabId. Lives on the SW's globalThis, so
 * it survives across multiple `executeScript` calls in the same SW lifetime
 * and dies when Chrome cycles the SW. That's fine for dev — the next click
 * after a SW restart re-records the call.
 */
export const SCRIPTS_REPLAY_SHIM_SOURCE = `;(function () {
  try {
    if (typeof globalThis !== "object" || !globalThis) return;
    var chromeRef =
      (globalThis.chrome && globalThis.chrome.scripting && typeof globalThis.chrome.scripting.executeScript === "function")
        ? globalThis.chrome
        : (globalThis.browser && globalThis.browser.scripting && typeof globalThis.browser.scripting.executeScript === "function")
          ? globalThis.browser
          : null;
    if (!chromeRef) return;
    if (globalThis.__extjsScriptsReplayInstalled) return;
    globalThis.__extjsScriptsReplayInstalled = true;

    var registry = new Map();
    var originalExecuteScript = chromeRef.scripting.executeScript.bind(chromeRef.scripting);

    var serialize = function (entry) {
      try {
        return JSON.stringify({
          files: entry && Array.isArray(entry.files) ? entry.files : [],
          world: entry && entry.world ? String(entry.world) : ""
        });
      } catch (error) {
        return "";
      }
    };

    var track = function (injection) {
      try {
        var tabId = injection && injection.target && injection.target.tabId;
        var files =
          injection && Array.isArray(injection.files) ? injection.files.slice() : null;
        if (typeof tabId !== "number") return;
        if (!files || !files.length) return;
        var world = injection.world ? String(injection.world) : undefined;
        var entry = { files: files, world: world, sig: serialize({ files: files, world: world }) };
        var existing = registry.get(tabId) || [];
        // Dedupe by signature — repeated identical injections (e.g. user
        // clicks the action twice) shouldn't stack in the replay list.
        if (existing.some(function (e) { return e.sig === entry.sig; })) return;
        existing.push(entry);
        // Cap to the most recent 50 distinct injections per tab so a misbehaving
        // user loop can't grow the registry unbounded.
        registry.set(tabId, existing.slice(-50));
      } catch (error) {
        // Tracking is best-effort; never break the user's executeScript call.
      }
    };

    chromeRef.scripting.executeScript = function (injection, callback) {
      track(injection);
      return originalExecuteScript(injection, callback);
    };

    var normalizeFile = function (value) {
      return String(value || "").replace(/^[/\\\\]+/, "");
    };

    var fileMatches = function (entryFile, changedNormalized) {
      var fn = normalizeFile(entryFile);
      for (var i = 0; i < changedNormalized.length; i++) {
        var c = changedNormalized[i];
        if (!c) continue;
        if (fn === c) return true;
        if (fn.length > c.length && fn.slice(fn.length - c.length - 1) === "/" + c) return true;
        if (c.length > fn.length && c.slice(c.length - fn.length - 1) === "/" + fn) return true;
      }
      return false;
    };

    globalThis.__extjsScriptsReplay = function (changedFiles) {
      var changedNormalized = (Array.isArray(changedFiles) ? changedFiles : []).map(normalizeFile);
      var promises = [];
      registry.forEach(function (entries, tabId) {
        entries.forEach(function (entry) {
          var matches = false;
          for (var i = 0; i < entry.files.length; i++) {
            if (fileMatches(entry.files[i], changedNormalized)) {
              matches = true;
              break;
            }
          }
          if (!matches) return;
          try {
            promises.push(
              originalExecuteScript({
                target: { tabId: tabId },
                files: entry.files,
                world: entry.world
              }).then(
                function () { return { ok: true, tabId: tabId, files: entry.files }; },
                function (error) {
                  return {
                    ok: false,
                    tabId: tabId,
                    files: entry.files,
                    error: String((error && error.message) || error)
                  };
                }
              )
            );
          } catch (error) {
            // Tab may have closed; skip silently.
          }
        });
      });
      return Promise.all(promises);
    };
  } catch (error) {
    // Best-effort shim; do not break the SW bootstrap on any failure.
  }
})();
`
