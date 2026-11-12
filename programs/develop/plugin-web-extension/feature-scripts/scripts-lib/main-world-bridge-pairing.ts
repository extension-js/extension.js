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
// A list of base readers leaves every other MAIN world file unpaired, the
// way a declared group that reads no base ships without its bridge.
export function buildMainWorldBridgePairingSource(
  bridgeFile: string = `${MAIN_WORLD_BRIDGE_ENTRY}.js`,
  baseReaders: string[] | null = null
): string {
  return `;(function () {
  var FILE = ${JSON.stringify(bridgeFile)};
  var READERS = ${JSON.stringify(baseReaders)};
  var PREFIX = ${JSON.stringify(MAIN_WORLD_BRIDGE_PAIR_PREFIX)};
  var MARK = ${JSON.stringify(MAIN_WORLD_BRIDGE_PAIRING_MARK)};
  var COPIED = ["matches", "excludeMatches", "allFrames", "matchOriginAsFallback", "persistAcrossSessions", "runAt"];
  var pairId = function (id) { return PREFIX + id; };
  var isPair = function (id) { return typeof id === "string" && id.indexOf(PREFIX) === 0; };
  var listOf = function (scripts) { return Array.isArray(scripts) ? scripts : []; };
  var readsBase = function (script) {
    if (!READERS) return true;
    return listOf(script.js).some(function (file) {
      return READERS.indexOf(String(file).replace(/^(\\.?\\/)+/, "")) !== -1;
    });
  };
  var wantsPair = function (script) { return script.world === "MAIN" && readsBase(script); };
  // The file clears the base once it has run, so each pair runs at its
  // file's own timing and right before it, never once for the whole page.
  var pairOf = function (script) {
    var pair = {id: pairId(script.id), js: [FILE]};
    for (var i = 0; i < COPIED.length; i++) {
      if (script[COPIED[i]] !== undefined && script[COPIED[i]] !== null) pair[COPIED[i]] = script[COPIED[i]];
    }
    return pair;
  };
  var install = function (root) {
    var scripting = root && root.scripting;
    if (!scripting || typeof scripting.registerContentScripts !== "function" || scripting[MARK]) return;
    var register = scripting.registerContentScripts.bind(scripting);
    var update = scripting.updateContentScripts.bind(scripting);
    var unregister = scripting.unregisterContentScripts.bind(scripting);
    var getRegistered = scripting.getRegisteredContentScripts.bind(scripting);
    var failed = function () {
      try { return !!(root.runtime && root.runtime.lastError); } catch (error) { return false; }
    };
    // A callback is answered from the browser's own callback, the one
    // place where runtime.lastError still names what went wrong.
    var callbackable = function (run) {
      return function () {
        var args = Array.prototype.slice.call(arguments);
        var done = typeof args[args.length - 1] === "function" ? args.pop() : null;
        var answered = false;
        var last = function (native, arg, shape, after) {
          var promised = function () {
            return native(arg).then(function (value) {
              var shaped = shape ? shape(value) : value;
              return after ? after().then(function () { return shaped; }) : shaped;
            });
          };
          if (!done) return promised();
          return new Promise(function (resolve, reject) {
            var answer = function () {
              var reply = Array.prototype.slice.call(arguments);
              var send = function () {
                answered = true;
                if (shape && Array.isArray(reply[0])) reply[0] = shape(reply[0]);
                done.apply(null, reply);
                resolve();
              };
              if (!after || failed()) return send();
              after().then(send, function (error) { console.error(error); send(); });
            };
            try {
              native(arg, answer);
            } catch (error) {
              // No callback form on this namespace, so the promise answers.
              promised().then(function (value) { answered = true; done(value); resolve(); }, reject);
            }
          });
        };
        if (!done) return run(args[0], last);
        var result;
        try { result = Promise.resolve(run(args[0], last)); } catch (error) { result = Promise.reject(error); }
        result.then(null, function (error) {
          if (answered) return;
          console.error(error);
          done();
        });
      };
    };
    var registeredById = function () {
      return getRegistered().then(function (all) {
        var byId = {};
        for (var i = 0; i < all.length; i++) byId[all[i].id] = all[i];
        return byId;
      });
    };
    scripting.registerContentScripts = callbackable(function (scripts, last) {
      var main = listOf(scripts).filter(function (script) {
        return script && wantsPair(script) && !isPair(script.id);
      });
      if (!main.length) return last(register, scripts);
      return registeredById().then(function (byId) {
        var ordered = [];
        var stale = [];
        // The browser runs same-timing files in registration order, so a
        // pair left without its file is dropped and registered again first.
        listOf(scripts).forEach(function (script) {
          if (main.indexOf(script) !== -1) {
            var known = !!byId[pairId(script.id)];
            if (known && !byId[script.id]) stale.push(pairId(script.id));
            if (!known || !byId[script.id]) ordered.push(pairOf(script));
          }
          ordered.push(script);
        });
        return (stale.length ? unregister({ids: stale}) : Promise.resolve()).then(function () {
          return last(register, ordered);
        });
      });
    });
    scripting.updateContentScripts = callbackable(function (scripts, last) {
      return registeredById().then(function (byId) {
        var add = [];
        var ordered = [];
        var drop = [];
        listOf(scripts).forEach(function (script) {
          if (script && byId[script.id] && !isPair(script.id)) {
            var next = Object.assign({}, byId[script.id], script);
            var paired = !!byId[pairId(script.id)];
            if (wantsPair(next)) {
              if (!paired) add.push(pairOf(next));
              ordered.push(pairOf(next));
            } else if (paired) drop.push(pairId(script.id));
          }
          ordered.push(script);
        });
        // An update moves a file to the end of the order, so each pair is
        // updated with its file and lands right before it again.
        return (add.length ? register(add) : Promise.resolve()).then(function () {
          return last(update, Array.isArray(scripts) ? ordered : scripts, null, drop.length ? function () {
            return unregister({ids: drop});
          } : null);
        });
      });
    });
    scripting.unregisterContentScripts = callbackable(function (filter, last) {
      var ids = filter && Array.isArray(filter.ids) ? filter.ids : null;
      // No ids clears every registration, the pairs included.
      if (!ids) return last(unregister, filter);
      return registeredById().then(function (byId) {
        var pairs = ids.map(pairId).filter(function (id) { return !!byId[id]; });
        return last(unregister, {ids: ids.concat(pairs)});
      });
    });
    scripting.getRegisteredContentScripts = callbackable(function (filter, last) {
      return last(getRegistered, filter, function (all) {
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
