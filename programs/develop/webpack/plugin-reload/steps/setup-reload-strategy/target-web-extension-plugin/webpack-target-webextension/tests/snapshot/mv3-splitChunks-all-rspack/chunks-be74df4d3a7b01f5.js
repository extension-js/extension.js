(() => { // webpackBootstrap
"use strict";
var __webpack_modules__ = ({
"./worker.js": (function (__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {
__webpack_require__.r(__webpack_exports__);
/* ESM import */var _util_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./util.js */ "./util.js");


let event
addEventListener('message', (e) => (event = e))

Promise.resolve()
  .then(
    (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.log)('Worker Test A: import.meta.url', () => {
      const url = new URL(/* asset import */__webpack_require__(/*! ./test.txt */ "./test.txt"), __webpack_require__.b).toString()
      ;(0,_util_js__WEBPACK_IMPORTED_MODULE_0__.test)(url.includes('-extension://'), "new URL('./test.txt', import.meta.url)\n", url)
    })
  )
  .then(
    (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.log)('Worker Test B: dynamic import', async () => {
      console.log("await import('./log.js')\n")
      const mod = await __webpack_require__.e(/*! import() */ "log_js").then(__webpack_require__.bind(__webpack_require__, /*! ./log.js */ "./log.js"))
      ;(0,_util_js__WEBPACK_IMPORTED_MODULE_0__.test)('file' in mod, mod)
    })
  )
  .then(() => new Promise((resolve) => setTimeout(resolve, 100)))
  .then(
    (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.log)('Worker Test C: message from background', () => {
      (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.test)(event?.data === 'Hello from background!', event.data)
    })
  )
  .finally(() => {
    postMessage('Hello from worker!')
  })


}),

});
/************************************************************************/
// The module cache
var __webpack_module_cache__ = {};

// The require function
function __webpack_require__(moduleId) {

// Check if module is in cache
var cachedModule = __webpack_module_cache__[moduleId];
if (cachedModule !== undefined) {
return cachedModule.exports;
}
// Create a new module (and put it into the cache)
var module = (__webpack_module_cache__[moduleId] = {
exports: {}
});
// Execute the module function
__webpack_modules__[moduleId](module, module.exports, __webpack_require__);

// Return the exports of the module
return module.exports;

}

// expose the modules object (__webpack_modules__)
__webpack_require__.m = __webpack_modules__;

// the startup function
__webpack_require__.x = () => {
// Load entry module and return exports
// This entry module depends on other loaded chunks and execution need to be delayed
var __webpack_exports__ = __webpack_require__.O(undefined, ["test_txt-util_js"], function() { return __webpack_require__("./worker.js") });
__webpack_exports__ = __webpack_require__.O(__webpack_exports__);
return __webpack_exports__
};

/************************************************************************/
// webpack/runtime/WebExtensionBrowserRuntime
(() => {
let isChrome, runtime;
try {
	if (typeof browser !== "undefined" && typeof browser.runtime?.getURL === "function") {
		runtime = browser;
	}
} catch (_) {}
if (!runtime) {
	try {
		if (typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function") {
			isChrome = true;
			runtime = chrome;
		}
	} catch (_) {}
}
__webpack_require__.webExtRtModern = !isChrome;
__webpack_require__.webExtRt = runtime || {
	get runtime() {
		throw new Error("No chrome or browser runtime found");
	}
}
})();
// webpack/runtime/define_property_getters
(() => {
__webpack_require__.d = function(exports, definition) {
	for(var key in definition) {
        if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
            Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
        }
    }
};
})();
// webpack/runtime/ensure_chunk
(() => {
__webpack_require__.f = {};
// This file contains only the entry chunk.
// The chunk loading function for additional chunks
__webpack_require__.e = function (chunkId) {
	return Promise.all(
		Object.keys(__webpack_require__.f).reduce(function (promises, key) {
			__webpack_require__.f[key](chunkId, promises);
			return promises;
		}, [])
	);
};

})();
// webpack/runtime/get javascript chunk filename
(() => {
// This function allow to reference chunks
        __webpack_require__.u = function (chunkId) {
          // return url for filenames not based on template
          if (chunkId === "test_txt-util_js") return "" + chunkId + ".js";
          // return url for filenames based on template
          return "chunks-" + "a976d497fd75f0ce" + ".js";
        };
      
})();
// webpack/runtime/global
(() => {
__webpack_require__.g = (function () {
	if (typeof globalThis === 'object') return globalThis;
	try {
		return this || new Function('return this')();
	} catch (e) {
		if (typeof window === 'object') return window;
	}
})();

})();
// webpack/runtime/has_own_property
(() => {
__webpack_require__.o = function (obj, prop) {
	return Object.prototype.hasOwnProperty.call(obj, prop);
};

})();
// webpack/runtime/make_namespace_object
(() => {
// define __esModule on exports
__webpack_require__.r = function(exports) {
	if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
	}
	Object.defineProperty(exports, '__esModule', { value: true });
};

})();
// webpack/runtime/on_chunk_loaded
(() => {
var deferred = [];
__webpack_require__.O = function (result, chunkIds, fn, priority) {
	if (chunkIds) {
		priority = priority || 0;
		for (var i = deferred.length; i > 0 && deferred[i - 1][2] > priority; i--)
			deferred[i] = deferred[i - 1];
		deferred[i] = [chunkIds, fn, priority];
		return;
	}
	var notFulfilled = Infinity;
	for (var i = 0; i < deferred.length; i++) {
		var chunkIds = deferred[i][0],
			fn = deferred[i][1],
			priority = deferred[i][2];
		var fulfilled = true;
		for (var j = 0; j < chunkIds.length; j++) {
			if (
				(priority & (1 === 0) || notFulfilled >= priority) &&
				Object.keys(__webpack_require__.O).every(function (key) {
					return __webpack_require__.O[key](chunkIds[j]);
				})
			) {
				chunkIds.splice(j--, 1);
			} else {
				fulfilled = false;
				if (priority < notFulfilled) notFulfilled = priority;
			}
		}
		if (fulfilled) {
			deferred.splice(i--, 1);
			var r = fn();
			if (r !== undefined) result = r;
		}
	}
	return result;
};

})();
// webpack/runtime/public_path
(() => {
__webpack_require__.p = "";

})();
// webpack/runtime/rspack_version
(() => {
__webpack_require__.rv = function () {
	return "1.1.6";
};

})();
// webpack/runtime/startup_chunk_dependencies
(() => {
var next = __webpack_require__.x;
        __webpack_require__.x = function() {
          return __webpack_require__.e("test_txt-util_js").then(next);
        };
})();
// webpack/runtime/publicPath
(() => {
let scriptUrl;
if (__webpack_require__.g.importScripts) scriptUrl = __webpack_require__.g.location + "";
const document = __webpack_require__.g.document;
if (!scriptUrl && document?.currentScript) {
	scriptUrl = document.currentScript.src;
}
// When supporting browsers where an automatic publicPath is not supported you must specify an output.publicPath manually via configuration
// or pass an empty string ("") and set the __webpack_public_path__ variable from your code to use your own logic.
if (!scriptUrl) {
	if (__webpack_require__.webExtRt) scriptUrl = __webpack_require__.webExtRt.runtime.getURL("/");
	else throw new Error("Automatic publicPath is not supported in this browser");
}
scriptUrl = scriptUrl.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/[^\/]+$/, "/");
__webpack_require__.p = scriptUrl;
})();
// webpack/runtime/import_scripts_chunk_loading
(() => {
__webpack_require__.b = self.location + "";
var installedChunks = {"worker_js": 1,};
// importScripts chunk loading
var installChunk = function (data) {
    var chunkIds = data[0];
    var moreModules = data[1];
    var runtime = data[2];
    for (var moduleId in moreModules) {
        if (__webpack_require__.o(moreModules, moduleId)) {
            __webpack_require__.m[moduleId] = moreModules[moduleId];
        }
    }
    if (runtime) runtime(__webpack_require__);
    while (chunkIds.length) installedChunks[chunkIds.pop()] = 1;
    parentChunkLoadingFunction(data);
};
__webpack_require__.f.i = function (chunkId, promises) {
    
          // "1" is the signal for "already loaded
          if (!installedChunks[chunkId]) {
            if (true) {
              importScripts(__webpack_require__.p + __webpack_require__.u(chunkId));
            }
          }
          
};
var chunkLoadingGlobal = self["webpackChunk"] = self["webpackChunk"] || [];
var parentChunkLoadingFunction = chunkLoadingGlobal.push.bind(chunkLoadingGlobal);
chunkLoadingGlobal.push = installChunk;

})();
// webpack/runtime/rspack_unique_id
(() => {
__webpack_require__.ruid = "bundler=rspack@1.1.6";

})();
/************************************************************************/
// run startup
var __webpack_exports__ = __webpack_require__.x();
})()
;