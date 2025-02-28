/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./test.txt":
/*!******************!*\
  !*** ./test.txt ***!
  \******************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

module.exports = __webpack_require__.p + "ae771fd2ba5e0558da2f.txt";

/***/ }),

/***/ "./util.js":
/*!*****************!*\
  !*** ./util.js ***!
  \*****************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   log: () => (/* binding */ log),
/* harmony export */   test: () => (/* binding */ test)
/* harmony export */ });
function log(label, f) {
  return async () => {
    console.group(label)
    await Promise.resolve().then(f).catch(console.error)
    console.groupEnd()
  }
}
function test(expr, ...args) {
  if (expr) console.log('[✅]', ...args)
  else console.error('[❌]', ...args)
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/WebExtensionBrowserRuntime */
/******/ 	(() => {
/******/ 		let isChrome, runtime;
/******/ 		try {
/******/ 			if (typeof browser !== "undefined" && typeof browser.runtime?.getURL === "function") {
/******/ 				runtime = browser;
/******/ 			}
/******/ 		} catch (_) {}
/******/ 		if (!runtime) {
/******/ 			try {
/******/ 				if (typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function") {
/******/ 					isChrome = true;
/******/ 					runtime = chrome;
/******/ 				}
/******/ 			} catch (_) {}
/******/ 		}
/******/ 		__webpack_require__.webExtRtModern = !isChrome;
/******/ 		__webpack_require__.webExtRt = runtime || {
/******/ 			get runtime() {
/******/ 				throw new Error("No chrome or browser runtime found");
/******/ 			}
/******/ 		}
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/ensure chunk */
/******/ 	(() => {
/******/ 		__webpack_require__.f = {};
/******/ 		// This file contains only the entry chunk.
/******/ 		// The chunk loading function for additional chunks
/******/ 		__webpack_require__.e = (chunkId) => {
/******/ 			return Promise.all(Object.keys(__webpack_require__.f).reduce((promises, key) => {
/******/ 				__webpack_require__.f[key](chunkId, promises);
/******/ 				return promises;
/******/ 			}, []));
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/get javascript chunk filename */
/******/ 	(() => {
/******/ 		// This function allow to reference async chunks
/******/ 		__webpack_require__.u = (chunkId) => {
/******/ 			// return url for filenames based on template
/******/ 			return "chunks-" + "ed0dde4f184158f0d66f" + ".js";
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/global */
/******/ 	(() => {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/load script */
/******/ 	(() => {
/******/ 		const classicLoader = (url, done) => {
/******/ 			const msg = { type: "WTW_INJECT", file: url };
/******/ 			const onError = (e) => {
/******/ 				done(Object.assign(e, { type: "missing" }))
/******/ 			};
/******/ 			if (__webpack_require__.webExtRtModern) {
/******/ 				__webpack_require__.webExtRt.runtime.sendMessage(msg).then(done, onError);
/******/ 			} else {
/******/ 				__webpack_require__.webExtRt.runtime.sendMessage(msg, () => {
/******/ 					const error = __webpack_require__.webExtRt.runtime.lastError;
/******/ 					if (error) onError(error);
/******/ 					else done();
/******/ 				});
/******/ 			}
/******/ 		};
/******/ 		const scriptLoader = (url, done) => {
/******/ 			const script = document.createElement('script');
/******/ 			script.src = url;
/******/ 			script.onload = done;
/******/ 			script.onerror = done;
/******/ 			document.body.appendChild(script);
/******/ 		}
/******/ 		const workerLoader = (url, done) => {
/******/ 			try {
/******/ 				importScripts(url);
/******/ 				done();
/******/ 			} catch (e) {
/******/ 				done(e);
/******/ 			}
/******/ 		}
/******/ 		const isWorker = typeof importScripts === 'function'
/******/ 		if (typeof location === 'object' && location.protocol.includes('-extension:')) {
/******/ 			__webpack_require__.l = isWorker ? workerLoader : scriptLoader;
/******/ 		}
/******/ 		else if (!isWorker) __webpack_require__.l = classicLoader;
/******/ 		else { throw new TypeError('Unable to determinate the chunk loader: content script + Worker'); }
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/publicPath */
/******/ 	(() => {
/******/ 		let scriptUrl;
/******/ 		if (__webpack_require__.g.importScripts) scriptUrl = __webpack_require__.g.location + "";
/******/ 		const document = __webpack_require__.g.document;
/******/ 		if (!scriptUrl && document?.currentScript) {
/******/ 			scriptUrl = document.currentScript.src;
/******/ 		}
/******/ 		// When supporting browsers where an automatic publicPath is not supported you must specify an output.publicPath manually via configuration
/******/ 		// or pass an empty string ("") and set the __webpack_public_path__ variable from your code to use your own logic.
/******/ 		if (!scriptUrl) {
/******/ 			if (__webpack_require__.webExtRt) scriptUrl = __webpack_require__.webExtRt.runtime.getURL("/");
/******/ 			else throw new Error("Automatic publicPath is not supported in this browser");
/******/ 		}
/******/ 		scriptUrl = scriptUrl.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/[^\/]+$/, "/");
/******/ 		__webpack_require__.p = scriptUrl;
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	(() => {
/******/ 		__webpack_require__.b = document.baseURI || self.location.href;
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			"content": 0
/******/ 		};
/******/ 		
/******/ 		__webpack_require__.f.j = (chunkId, promises) => {
/******/ 				// JSONP chunk loading for javascript
/******/ 				var installedChunkData = __webpack_require__.o(installedChunks, chunkId) ? installedChunks[chunkId] : undefined;
/******/ 				if(installedChunkData !== 0) { // 0 means "already installed".
/******/ 		
/******/ 					// a Promise means "currently loading".
/******/ 					if(installedChunkData) {
/******/ 						promises.push(installedChunkData[2]);
/******/ 					} else {
/******/ 						if(true) { // all chunks have JS
/******/ 							// setup Promise in chunk cache
/******/ 							var promise = new Promise((resolve, reject) => (installedChunkData = installedChunks[chunkId] = [resolve, reject]));
/******/ 							promises.push(installedChunkData[2] = promise);
/******/ 		
/******/ 							// start chunk loading
/******/ 							var url = __webpack_require__.p + __webpack_require__.u(chunkId);
/******/ 							// create error before stack unwound to get useful stacktrace later
/******/ 							var error = new Error();
/******/ 							var loadingEnded = (event) => {
/******/ 								if(__webpack_require__.o(installedChunks, chunkId)) {
/******/ 									installedChunkData = installedChunks[chunkId];
/******/ 									if(installedChunkData !== 0) installedChunks[chunkId] = undefined;
/******/ 									if(installedChunkData) {
/******/ 										var errorType = event && (event.type === 'load' ? 'missing' : event.type);
/******/ 										var realSrc = event && event.target && event.target.src;
/******/ 										error.message = 'Loading chunk ' + chunkId + ' failed.\n(' + errorType + ': ' + realSrc + ')';
/******/ 										error.name = 'ChunkLoadError';
/******/ 										error.type = errorType;
/******/ 										error.request = realSrc;
/******/ 										installedChunkData[1](error);
/******/ 									}
/******/ 								}
/******/ 							};
/******/ 							__webpack_require__.l(url, loadingEnded, "chunk-" + chunkId, chunkId);
/******/ 						}
/******/ 					}
/******/ 				}
/******/ 		};
/******/ 		
/******/ 		// no prefetching
/******/ 		
/******/ 		// no preloaded
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 		
/******/ 		// no on chunks loaded
/******/ 		
/******/ 		// install a JSONP callback for chunk loading
/******/ 		var webpackJsonpCallback = (parentChunkLoadingFunction, data) => {
/******/ 			var [chunkIds, moreModules, runtime] = data;
/******/ 			// add "moreModules" to the modules object,
/******/ 			// then flag all "chunkIds" as loaded and fire callback
/******/ 			var moduleId, chunkId, i = 0;
/******/ 			if(chunkIds.some((id) => (installedChunks[id] !== 0))) {
/******/ 				for(moduleId in moreModules) {
/******/ 					if(__webpack_require__.o(moreModules, moduleId)) {
/******/ 						__webpack_require__.m[moduleId] = moreModules[moduleId];
/******/ 					}
/******/ 				}
/******/ 				if(runtime) var result = runtime(__webpack_require__);
/******/ 			}
/******/ 			if(parentChunkLoadingFunction) parentChunkLoadingFunction(data);
/******/ 			for(;i < chunkIds.length; i++) {
/******/ 				chunkId = chunkIds[i];
/******/ 				if(__webpack_require__.o(installedChunks, chunkId) && installedChunks[chunkId]) {
/******/ 					installedChunks[chunkId][0]();
/******/ 				}
/******/ 				installedChunks[chunkId] = 0;
/******/ 			}
/******/ 		
/******/ 		}
/******/ 		
/******/ 		var chunkLoadingGlobal = self["webpackChunk"] = self["webpackChunk"] || [];
/******/ 		chunkLoadingGlobal.forEach(webpackJsonpCallback.bind(null, 0));
/******/ 		chunkLoadingGlobal.push = webpackJsonpCallback.bind(null, chunkLoadingGlobal.push.bind(chunkLoadingGlobal));
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!********************!*\
  !*** ./content.js ***!
  \********************/
__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _util_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./util.js */ "./util.js");
/// <reference lib="dom" />
// @ts-check



Promise.resolve()
  .then(
    (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.log)('Test A: import.meta.url', () => {
      const url = new URL(/* asset import */ __webpack_require__(/*! ./test.txt */ "./test.txt"), __webpack_require__.b).toString()
      ;(0,_util_js__WEBPACK_IMPORTED_MODULE_0__.test)(url.includes('-extension://'), "new URL('./test.txt', import.meta.url)\n", url)
    })
  )
  .then(
    (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.log)('Test B: __webpack_public_path__', () => {
      (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.test)(__webpack_require__.p.includes('-extension://'), '__webpack_public_path__\n', __webpack_require__.p)
    })
  )
  .then(
    (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.log)('Test C: dynamic import', async () => {
      console.log("await import('./log.js')\n")
      const mod = await __webpack_require__.e(/*! import() */ "log_js").then(__webpack_require__.bind(__webpack_require__, /*! ./log.js */ "./log.js"))
      ;(0,_util_js__WEBPACK_IMPORTED_MODULE_0__.test)('file' in mod, mod)
    })
  )
  .then(() => {
    chrome.runtime.sendMessage('Hello from content script!')
    chrome.runtime.onMessage.addListener((message) => {
      console.log('Message from background:', message)
    })
  })

})();

/******/ })()
;