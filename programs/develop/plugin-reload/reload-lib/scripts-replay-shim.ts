// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

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

    var MAX_TABS = 50;
    var MAX_ENTRIES_PER_TAB = 50;
    var registry = new Map();
    var originalExecuteScript = chromeRef.scripting.executeScript.bind(chromeRef.scripting);
    var tabsApi = chromeRef.tabs && typeof chromeRef.tabs.get === "function" ? chromeRef.tabs : null;

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

    var pageKey = function (url) {
      if (typeof url !== "string" || !url) return "";
      try {
        var parsed = new URL(url);
        return parsed.origin + parsed.pathname;
      } catch (error) {
        return url;
      }
    };

    // Resolves to the page the tab shows now, "" when the url is not visible
    // to the extension, and null once the tab is gone.
    var currentPage = function (tabId) {
      if (!tabsApi) return Promise.resolve("");
      try {
        var lookup = tabsApi.get(tabId);
        if (!lookup || typeof lookup.then !== "function") return Promise.resolve("");
        return lookup.then(
          function (tab) { return tab ? pageKey(tab.url) : null; },
          function () { return null; }
        );
      } catch (error) {
        return Promise.resolve("");
      }
    };

    var remember = function (tabId, entry) {
      var entries = (registry.get(tabId) || []).filter(function (e) { return e.sig !== entry.sig; });
      entries.push(entry);
      registry.delete(tabId);
      registry.set(tabId, entries.slice(-MAX_ENTRIES_PER_TAB));
      while (registry.size > MAX_TABS) {
        registry.delete(registry.keys().next().value);
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
        var entry = { files: files, world: world, sig: serialize({ files: files, world: world }), page: "" };
        remember(tabId, entry);
        currentPage(tabId).then(function (page) {
          entry.page = page || "";
        }, function () {});
      } catch (error) {
        // Ignore
      }
    };

    chromeRef.scripting.executeScript = function (injection, callback) {
      track(injection);
      return originalExecuteScript(injection, callback);
    };

    try {
      if (chromeRef.tabs && chromeRef.tabs.onRemoved && typeof chromeRef.tabs.onRemoved.addListener === "function") {
        chromeRef.tabs.onRemoved.addListener(function (tabId) {
          registry.delete(tabId);
        });
      }
    } catch (error) {
      // Ignore
    }

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

    var entryMatches = function (entry, changedNormalized) {
      for (var i = 0; i < entry.files.length; i++) {
        if (fileMatches(entry.files[i], changedNormalized)) return true;
      }
      return false;
    };

    var replayEntry = function (tabId, entry) {
      try {
        return Promise.resolve(
          originalExecuteScript({
            target: { tabId: tabId },
            files: entry.files,
            world: entry.world
          })
        ).then(
          function () { return { ok: true, tabId: tabId, files: entry.files }; },
          function (error) {
            return {
              ok: false,
              tabId: tabId,
              files: entry.files,
              error: String((error && error.message) || error)
            };
          }
        );
      } catch (error) {
        return Promise.resolve(null);
      }
    };

    var replayTab = function (tabId, changedNormalized) {
      return currentPage(tabId).then(function (page) {
        if (page === null) {
          registry.delete(tabId);
          return [];
        }
        // An entry recorded on another page belongs to a document this tab
        // no longer shows, so it is dropped instead of injected into the new one.
        var live = (registry.get(tabId) || []).filter(function (entry) {
          return !(page && entry.page && entry.page !== page);
        });
        if (!live.length) {
          registry.delete(tabId);
          return [];
        }
        registry.set(tabId, live);
        return Promise.all(
          live
            .filter(function (entry) { return entryMatches(entry, changedNormalized); })
            .map(function (entry) { return replayEntry(tabId, entry); })
        );
      }, function () { return []; });
    };

    globalThis.__extjsScriptsReplay = function (changedFiles) {
      var changedNormalized = (Array.isArray(changedFiles) ? changedFiles : []).map(normalizeFile);
      var tabReplays = [];
      registry.forEach(function (entries, tabId) {
        if (!entries.some(function (entry) { return entryMatches(entry, changedNormalized); })) return;
        tabReplays.push(replayTab(tabId, changedNormalized));
      });
      return Promise.all(tabReplays).then(function (perTab) {
        var outcomes = [];
        perTab.forEach(function (results) {
          results.forEach(function (result) {
            if (result) outcomes.push(result);
          });
        });
        return outcomes;
      });
    };
  } catch (error) {
    // Best-effort shim; do not break the SW bootstrap on any failure.
  }
})();
`
