// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {EXTENSION_BASE_GLOBAL} from '../../../lib/extension-base-from-stack'

export const MAIN_WORLD_BRIDGE_ENTRY = 'scripts/extjs-main-world-bridge'
export const MAIN_WORLD_BRIDGE_PAIR_PREFIX = 'extjs-main-world-bridge:'
export const MAIN_WORLD_BRIDGE_PAIRING_MARK = '__extjsMainWorldBridgePaired'

// Firefox names no extension file on a MAIN world stack, so a file the
// background or a page registers there needs the bridge a declared group gets.
// A list of base readers leaves every other MAIN world file unpaired, the
// way a declared group that reads no base ships without its bridge.
export function buildMainWorldBridgePairingSource(
  bridgeFile: string = `${MAIN_WORLD_BRIDGE_ENTRY}.js`,
  baseReaders: string[] | null = null,
  injectable: string[] | null = baseReaders,
  baseGlobal: string = EXTENSION_BASE_GLOBAL
): string {
  return `;(function () {
  var FILE = ${JSON.stringify(bridgeFile)};
  var READERS = ${JSON.stringify(baseReaders)};
  var INJECTABLE = ${JSON.stringify(injectable)};
  var PREFIX = ${JSON.stringify(MAIN_WORLD_BRIDGE_PAIR_PREFIX)};
  var MARK = ${JSON.stringify(MAIN_WORLD_BRIDGE_PAIRING_MARK)};
  var COPIED = ["matches", "excludeMatches", "allFrames", "matchOriginAsFallback", "persistAcrossSessions", "runAt"];
  // The browser takes no id that starts with an underscore, so this entry
  // has the shape of a registration and can never become one.
  var REFUSED = {id: "_" + PREFIX, js: [FILE], matches: ["*://extjs.invalid/*"]};
  var pairId = function (id) { return PREFIX + id; };
  var isPair = function (id) { return typeof id === "string" && id.indexOf(PREFIX) === 0; };
  var listOf = function (scripts) { return Array.isArray(scripts) ? scripts : []; };
  var namesOneOf = function (known, files) {
    if (!known) return true;
    return listOf(files).some(function (file) {
      return known.indexOf(String(file).replace(/^(\\.?\\/)+/, "")) !== -1;
    });
  };
  var wantsPair = function (script) { return script.world === "MAIN" && namesOneOf(READERS, script.js); };
  var TARGETED = ["tabId", "frameIds", "allFrames", "documentIds"];
  var wantsBridge = function (injection) {
    return !!injection && injection.world === "MAIN" && !!injection.target && typeof injection.target.tabId === "number" &&
      Array.isArray(injection.files) && injection.files.length > 0 && namesOneOf(INJECTABLE, injection.files);
  };
  var clearBase = function () {
    try { delete window.wrappedJSObject[${JSON.stringify(baseGlobal)}]; } catch (error) {}
    try { document.documentElement.removeAttribute("data-extjs-extension-base"); } catch (error) {}
  };
  var unread = function (frames) {
    return !Array.isArray(frames) || frames.some(function (frame) { return !!(frame && frame.error); });
  };
  // The bridge runs in the frames the file is about to run in, no others.
  var bridgeFor = function (injection) {
    var target = {};
    for (var i = 0; i < TARGETED.length; i++) {
      if (injection.target[TARGETED[i]] !== undefined) target[TARGETED[i]] = injection.target[TARGETED[i]];
    }
    return {target: target, files: [FILE], world: "ISOLATED"};
  };
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
    var settle = function () {};
    // The browser checks the shape of a call as it is made. The same call
    // with an entry it refuses later throws that check and changes nothing.
    var shaped = function (native, args, refusable) {
      var probe = Array.prototype.slice.call(args);
      if (probe.length) probe[0] = refusable;
      var called = typeof probe[probe.length - 1] === "function";
      if (called) probe[probe.length - 1] = function () { failed(); };
      var refused;
      try {
        refused = native.apply(null, probe);
      } catch (error) {
        if (!called) throw error;
        // A namespace with no callback form refuses the callback, not the call.
        probe.pop();
        refused = native.apply(null, probe);
      }
      if (refused && typeof refused.then === "function") refused.then(settle, settle);
    };
    // A callback is answered from the browser's own callback, the one
    // place where runtime.lastError still names what went wrong.
    var callbackable = function (run) {
      return function () {
        var args = Array.prototype.slice.call(arguments);
        var done = typeof args[args.length - 1] === "function" ? args.pop() : null;
        var answered = false;
        var last = function (native, arg, shape, after, undo) {
          var promised = function () {
            return native(arg).then(function (value) {
              var visible = shape ? shape(value) : value;
              return after ? after().then(function () { return visible; }) : visible;
            }, function (error) {
              if (undo) undo();
              throw error;
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
              if (failed()) {
                if (undo) undo();
                return send();
              }
              if (!after) return send();
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
    var pairable = function (script) { return !!script && wantsPair(script) && !isPair(script.id); };
    var registerPaired = callbackable(function (scripts, last) {
      var main = scripts.filter(pairable);
      return registeredById().then(function (byId) {
        var ordered = [];
        var stale = [];
        var seen = {};
        // The browser runs same-timing files in registration order, so a
        // pair left without its file is dropped and registered again first.
        scripts.forEach(function (script) {
          // An id named twice gets one pair, so the browser names the id.
          if (main.indexOf(script) !== -1 && !seen[script.id]) {
            seen[script.id] = true;
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
    scripting.registerContentScripts = function (scripts) {
      if (!Array.isArray(scripts) || !scripts.some(pairable)) return register.apply(null, arguments);
      shaped(register, arguments, scripts.concat([REFUSED, REFUSED]));
      return registerPaired.apply(null, arguments);
    };
    var updatePaired = callbackable(function (scripts, last) {
      return registeredById().then(function (byId) {
        var add = [];
        var ordered = [];
        var drop = [];
        var seen = {};
        scripts.forEach(function (script) {
          if (script && byId[script.id] && !isPair(script.id) && !seen[script.id]) {
            seen[script.id] = true;
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
          // A refused update leaves no pair behind for a file it never moved.
          return last(update, ordered, null, drop.length ? function () {
            return unregister({ids: drop});
          } : null, add.length ? function () {
            unregister({ids: add.map(function (pair) { return pair.id; })}).then(settle, settle);
          } : null);
        });
      });
    });
    scripting.updateContentScripts = function (scripts) {
      if (!Array.isArray(scripts) || !scripts.length) return update.apply(null, arguments);
      shaped(update, arguments, scripts.concat([{id: REFUSED.id}]));
      return updatePaired.apply(null, arguments);
    };
    var unregisterPaired = callbackable(function (filter, last) {
      return registeredById().then(function (byId) {
        var pairs = filter.ids.map(pairId).filter(function (id, at, all) { return !!byId[id] && all.indexOf(id) === at; });
        return last(unregister, Object.assign({}, filter, {ids: filter.ids.concat(pairs)}));
      });
    });
    // No ids clears every registration, the pairs included.
    scripting.unregisterContentScripts = function (filter) {
      if (!filter || !Array.isArray(filter.ids) || !filter.ids.length) return unregister.apply(null, arguments);
      shaped(unregister, arguments, Object.assign({}, filter, {ids: filter.ids.concat([REFUSED.id])}));
      return unregisterPaired.apply(null, arguments);
    };
    var getVisible = callbackable(function (filter, last) {
      return last(getRegistered, filter, function (all) {
        return all.filter(function (script) { return !isPair(script.id); });
      });
    });
    scripting.getRegisteredContentScripts = function (filter) {
      shaped(getRegistered, arguments, filter);
      return getVisible.apply(null, arguments);
    };
    if (typeof scripting.executeScript === "function") {
      var execute = scripting.executeScript.bind(scripting);
      var lanes = {};
      // A file that never ran left the base unread, so it is taken back.
      var sweep = function (target) {
        try {
          return Promise.resolve(execute({target: target, func: clearBase, world: "ISOLATED"})).then(settle, settle);
        } catch (error) {
          return Promise.resolve();
        }
      };
      // The browser checks the shape of a call as it is made. The same call
      // on a tab that cannot exist throws what the author's own would have.
      var checked = function (args) {
        var probe = Array.prototype.slice.call(args);
        probe[0] = Object.assign({}, args[0], {target: Object.assign({}, args[0].target, {tabId: -1})});
        if (typeof probe[probe.length - 1] === "function") probe[probe.length - 1] = function () { failed(); };
        var refused = execute.apply(null, probe);
        if (refused && typeof refused.then === "function") refused.then(settle, settle);
      };
      var inLane = function (key, run) {
        var turn = (lanes[key] || Promise.resolve()).then(run);
        var tail = turn.then(settle, settle);
        lanes[key] = tail;
        tail.then(function () { if (lanes[key] === tail) delete lanes[key]; });
        return turn;
      };
      // A file clears the base it read, so two injections into one tab take
      // turns. A Web Lock keeps them across every realm of the extension.
      var inTurn = function (key, run) {
        var started = false;
        try {
          var locks = globalThis.navigator && globalThis.navigator.locks;
          if (locks && typeof locks.request === "function") {
            return Promise.resolve(locks.request(PREFIX + key, function () { started = true; return run(); })).then(null, function (error) {
              if (started) throw error;
              return inLane(key, run);
            });
          }
        } catch (error) {
          if (started) return Promise.reject(error);
        }
        return inLane(key, run);
      };
      scripting.executeScript = function (injection) {
        var args = arguments;
        if (!wantsBridge(injection)) return execute.apply(null, args);
        checked(args);
        var done = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
        var bridge = bridgeFor(injection);
        var run = function () {
          var bridged = false;
          var ahead;
          try {
            ahead = Promise.resolve(execute(bridge)).then(function () { bridged = true; }, settle);
          } catch (error) {
            ahead = Promise.resolve();
          }
          return ahead.then(function () {
            if (!done) {
              return execute.apply(null, args).then(function (frames) {
                return bridged && unread(frames) ? sweep(bridge.target).then(function () { return frames; }) : frames;
              }, function (error) {
                return (bridged ? sweep(bridge.target) : Promise.resolve()).then(function () { throw error; });
              });
            }
            return new Promise(function (resolve) {
              var answer = function (frames) {
                var swept = bridged && (failed() || unread(frames)) ? sweep(bridge.target) : null;
                try { done.apply(null, arguments); } finally { swept ? swept.then(resolve) : resolve(); }
              };
              execute(injection, answer);
            });
          });
        };
        var turn = inTurn("tab:" + injection.target.tabId, run);
        if (!done) return turn;
        turn.then(null, function (error) { console.error(error); done(); });
      };
    }
    scripting[MARK] = true;
  };
  try {
    install(globalThis.browser);
    install(globalThis.chrome);
  } catch (error) {}
})();`
}
