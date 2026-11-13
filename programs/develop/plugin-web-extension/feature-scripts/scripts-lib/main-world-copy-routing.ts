// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {REFUSED_SCRIPT_ID} from './main-world-bridge-pairing'

export const MAIN_WORLD_COPY_ROUTING_MARK = '__extjsMainWorldCopiesRouted'

// A file both worlds run ships twice under one author name, so each call
// is routed as it is made. The map is from each file to its MAIN world copy.
export function buildMainWorldCopyRoutingSource(
  copies: Record<string, string>
): string {
  return `;(function () {
  var COPIES = ${JSON.stringify(copies)};
  var MARK = ${JSON.stringify(MAIN_WORLD_COPY_ROUTING_MARK)};
  var REFUSED = ${JSON.stringify(REFUSED_SCRIPT_ID)};
  var settle = function () {};
  var FILES = {};
  for (var file in COPIES) FILES[COPIES[file]] = file;
  var has = function (map, key) { return Object.prototype.hasOwnProperty.call(map, key); };
  var isObject = function (value) { return !!value && typeof value === "object"; };
  // A leading slash or dot stays as the author wrote it.
  var route = function (map, file) {
    if (typeof file !== "string") return file;
    var key = file.replace(/^(\\.?\\/)+/, "");
    return has(map, key) ? file.slice(0, file.length - key.length) + map[key] : file;
  };
  var routeAll = function (map, files) {
    return Array.isArray(files) ? files.map(function (file) { return route(map, file); }) : files;
  };
  var forWorld = function (world, files) {
    var named = routeAll(FILES, files);
    return world === "MAIN" ? routeAll(COPIES, named) : named;
  };
  var same = function (left, right) {
    if (left.length !== right.length) return false;
    for (var i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  };
  var asWritten = function (script) {
    if (!isObject(script) || !Array.isArray(script.js)) return script;
    return Object.assign({}, script, {js: routeAll(FILES, script.js)});
  };
  var install = function (root) {
    var scripting = root && root.scripting;
    if (!scripting || typeof scripting.registerContentScripts !== "function" || scripting[MARK]) return;
    var register = scripting.registerContentScripts.bind(scripting);
    var update = scripting.updateContentScripts.bind(scripting);
    var getRegistered = scripting.getRegisteredContentScripts.bind(scripting);
    // The browser checks the shape of a call as it is made. The same call
    // with an id it refuses later throws that check here and changes nothing.
    var shaped = function (given, scripts) {
      var probe = Array.prototype.slice.call(given);
      probe[0] = scripts.concat([{id: REFUSED}]);
      var called = typeof probe[probe.length - 1] === "function";
      if (called) probe[probe.length - 1] = function () { try { void (root.runtime && root.runtime.lastError); } catch (error) {} };
      var refused;
      try {
        refused = update.apply(null, probe);
      } catch (error) {
        if (!called) throw error;
        // A namespace with no callback form refuses the callback, not the call.
        probe.pop();
        refused = update.apply(null, probe);
      }
      if (refused && typeof refused.then === "function") refused.then(settle, settle);
    };
    scripting.registerContentScripts = function (scripts) {
      var args = Array.prototype.slice.call(arguments);
      if (Array.isArray(scripts)) {
        args[0] = scripts.map(function (script) {
          if (!isObject(script) || script.world !== "MAIN" || !Array.isArray(script.js)) return script;
          return Object.assign({}, script, {js: routeAll(COPIES, script.js)});
        });
      }
      return register.apply(null, args);
    };
    // An update may name the files or the world alone, and the browser
    // keeps the other, so that one is read from the registry first.
    scripting.updateContentScripts = function (scripts) {
      var given = arguments;
      var args = Array.prototype.slice.call(arguments);
      if (!Array.isArray(scripts)) return update.apply(null, given);
      var partial = scripts.some(function (script) {
        return isObject(script) && (script.js === undefined) !== (script.world === undefined);
      });
      var routed = function (registered) {
        var byId = {};
        (Array.isArray(registered) ? registered : []).forEach(function (script) { if (isObject(script)) byId[script.id] = script; });
        return scripts.map(function (script) {
          if (!isObject(script) || (script.js === undefined && script.world === undefined)) return script;
          var known = byId[script.id];
          var world = script.world !== undefined ? script.world : known && known.world;
          var js = script.js !== undefined ? script.js : known && known.js;
          if (!Array.isArray(js)) return script;
          var next = forWorld(world, js);
          if (script.js === undefined && same(next, js)) return script;
          return Object.assign({}, script, {js: next});
        });
      };
      if (!partial) {
        args[0] = routed([]);
        return update.apply(null, args);
      }
      shaped(given, scripts);
      var ids = scripts.filter(isObject).map(function (script) { return script.id; }).filter(function (id) { return typeof id === "string"; });
      var done = typeof args[args.length - 1] === "function";
      var settle = function (registered) {
        args[0] = routed(registered);
        return update.apply(null, args);
      };
      if (!done) return getRegistered({ids: ids}).then(settle, function () { return settle([]); });
      try {
        getRegistered({ids: ids}, function (registered) {
          try { void (root.runtime && root.runtime.lastError); } catch (error) {}
          settle(registered);
        });
      } catch (error) {
        // No callback form here, so the browser refuses the author's own call.
        return update.apply(null, given);
      }
    };
    scripting.getRegisteredContentScripts = function () {
      var args = Array.prototype.slice.call(arguments);
      var last = args.length - 1;
      var shape = function (list) { return Array.isArray(list) ? list.map(asWritten) : list; };
      if (last >= 0 && typeof args[last] === "function") {
        var done = args[last];
        args[last] = function (list) {
          var reply = Array.prototype.slice.call(arguments);
          if (reply.length) reply[0] = shape(list);
          return done.apply(this, reply);
        };
        return getRegistered.apply(null, args);
      }
      var result = getRegistered.apply(null, args);
      return result && typeof result.then === "function" ? result.then(shape) : result;
    };
    if (typeof scripting.executeScript === "function") {
      var execute = scripting.executeScript.bind(scripting);
      scripting.executeScript = function (injection) {
        var args = Array.prototype.slice.call(arguments);
        if (isObject(injection) && injection.world === "MAIN" && Array.isArray(injection.files)) {
          args[0] = Object.assign({}, injection, {files: routeAll(COPIES, injection.files)});
        }
        return execute.apply(null, args);
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
