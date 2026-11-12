// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export const MAIN_WORLD_BRIDGE_ENTRY = 'scripts/extjs-main-world-bridge'
export const MAIN_WORLD_BRIDGE_PAIR_PREFIX = 'extjs-main-world-bridge:'
export const MAIN_WORLD_BRIDGE_PAIRING_MARK = '__extjsMainWorldBridgePaired'

// Firefox names no extension file on a MAIN world stack, so a file the
// background registers there needs the bridge a declared group gets.
export function buildMainWorldBridgePairingSource(
  bridgeFile: string = `${MAIN_WORLD_BRIDGE_ENTRY}.js`
): string {
  return `;(function () {
  var FILE = ${JSON.stringify(bridgeFile)};
  var PREFIX = ${JSON.stringify(MAIN_WORLD_BRIDGE_PAIR_PREFIX)};
  var MARK = ${JSON.stringify(MAIN_WORLD_BRIDGE_PAIRING_MARK)};
  var COPIED = ["matches", "excludeMatches", "allFrames", "matchOriginAsFallback", "persistAcrossSessions"];
  var pairId = function (id) { return PREFIX + id; };
  var isPair = function (id) { return typeof id === "string" && id.indexOf(PREFIX) === 0; };
  var listOf = function (scripts) { return Array.isArray(scripts) ? scripts : []; };
  var pairOf = function (script) {
    var pair = {id: pairId(script.id), js: [FILE], runAt: "document_start"};
    for (var i = 0; i < COPIED.length; i++) {
      if (script[COPIED[i]] !== undefined && script[COPIED[i]] !== null) pair[COPIED[i]] = script[COPIED[i]];
    }
    return pair;
  };
  // A caller that passes a callback gets it called once the pair settles.
  var callbackable = function (run) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var done = typeof args[args.length - 1] === "function" ? args.pop() : null;
      var result = run.apply(null, args);
      if (!done) return result;
      result.then(done, function (error) { console.error(error); done(); });
    };
  };
  var install = function (root) {
    var scripting = root && root.scripting;
    if (!scripting || typeof scripting.registerContentScripts !== "function" || scripting[MARK]) return;
    var register = scripting.registerContentScripts.bind(scripting);
    var update = scripting.updateContentScripts.bind(scripting);
    var unregister = scripting.unregisterContentScripts.bind(scripting);
    var getRegistered = scripting.getRegisteredContentScripts.bind(scripting);
    var registeredById = function () {
      return getRegistered().then(function (all) {
        var byId = {};
        for (var i = 0; i < all.length; i++) byId[all[i].id] = all[i];
        return byId;
      });
    };
    scripting.registerContentScripts = callbackable(function (scripts) {
      var main = listOf(scripts).filter(function (script) {
        return script && script.world === "MAIN" && !isPair(script.id);
      });
      if (!main.length) return register(scripts);
      return registeredById().then(function (byId) {
        var fresh = [];
        var stale = [];
        // The browser runs same-timing files in registration order, so a
        // pair left without its file is dropped and registered again first.
        main.forEach(function (script) {
          if (byId[pairId(script.id)]) {
            if (byId[script.id]) return;
            stale.push(pairId(script.id));
          }
          fresh.push(pairOf(script));
        });
        return (stale.length ? unregister({ids: stale}) : Promise.resolve()).then(function () {
          return register(fresh.concat(scripts));
        });
      });
    });
    scripting.updateContentScripts = callbackable(function (scripts) {
      return registeredById().then(function (byId) {
        var add = [];
        var change = [];
        var drop = [];
        listOf(scripts).forEach(function (script) {
          if (!script || !byId[script.id] || isPair(script.id)) return;
          var next = Object.assign({}, byId[script.id], script);
          var paired = !!byId[pairId(script.id)];
          if (next.world === "MAIN") (paired ? change : add).push(pairOf(next));
          else if (paired) drop.push(pairId(script.id));
        });
        // An update moves a file to the end of the order, so the pairs lead.
        return (add.length ? register(add) : Promise.resolve()).then(function () {
          return update(change.concat(scripts));
        }).then(function () {
          if (drop.length) return unregister({ids: drop});
        });
      });
    });
    scripting.unregisterContentScripts = callbackable(function (filter) {
      var ids = filter && Array.isArray(filter.ids) ? filter.ids : null;
      // No ids clears every registration, the pairs included.
      if (!ids) return unregister(filter);
      return registeredById().then(function (byId) {
        var pairs = ids.map(pairId).filter(function (id) { return !!byId[id]; });
        return unregister({ids: ids.concat(pairs)});
      });
    });
    scripting.getRegisteredContentScripts = callbackable(function (filter) {
      return getRegistered(filter).then(function (all) {
        return all.filter(function (script) { return !isPair(script.id); });
      });
    });
    scripting[MARK] = true;
  };
  try {
    install(globalThis.browser);
    install(globalThis.chrome);
  } catch (error) {}
})();`
}
