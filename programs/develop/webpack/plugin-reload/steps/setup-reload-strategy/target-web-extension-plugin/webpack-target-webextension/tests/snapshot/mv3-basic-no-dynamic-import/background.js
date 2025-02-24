/******/ try { // If the initial code of the serviceWorkerEntry throws, the console cannot be opened.
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
/******/ 	/* webpack/runtime/get javascript chunk filename */
/******/ 	(() => {
/******/ 		// This function allow to reference async chunks
/******/ 		__webpack_require__.u = (chunkId) => {
/******/ 			// return url for filenames based on template
/******/ 			return "chunks-" + "325e808fa64381f9dddb" + ".js";
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
/******/ 	/* webpack/runtime/importScripts chunk loading */
/******/ 	(() => {
/******/ 		__webpack_require__.b = self.location + "";
/******/ 		
/******/ 		// object to store loaded chunks
/******/ 		// "1" means "already loaded"
/******/ 		var installedChunks = {
/******/ 			"background": 1
/******/ 		};
/******/ 		
/******/ 		// no chunk install function needed
/******/ 		// no chunk loading
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/chunk loader fallback */
/******/ 	(() => {
/******/ 		__webpack_require__.webExtRt.runtime.onMessage.addListener((message, sender, sendResponse) => {
/******/ 			if (message?.type != "WTW_INJECT" || typeof sender?.tab?.id != "number") return;
/******/ 			let file = message.file;
/******/ 			try {
/******/ 				file = new URL(file).pathname;
/******/ 			} catch (_) {}
/******/ 			if (!file) return;
/******/ 			if (__webpack_require__.webExtRt.scripting) {
/******/ 				__webpack_require__.webExtRt.scripting.executeScript({
/******/ 					target: { tabId: sender.tab.id, frameIds: [sender.frameId] },
/******/ 					files: [file],
/******/ 				}).then(sendResponse);
/******/ 			} else {
/******/ 				const details = { frameId: sender.frameId, file, matchAboutBlank: true };
/******/ 				if (__webpack_require__.webExtRtModern) {
/******/ 				__webpack_require__.webExtRt.tabs.executeScript(sender.tab.id, details).then(sendResponse);
/******/ 				} else {
/******/ 				__webpack_require__.webExtRt.tabs.executeScript(sender.tab.id, details, sendResponse);
/******/ 				}
/******/ 			}
/******/ 			return true;
/******/ 		});
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!***********************!*\
  !*** ./background.js ***!
  \***********************/
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
    (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.log)('Test C: new Worker()', async () => {
      if (typeof Worker === 'undefined') {
        console.log('Worker is not supported.')
        return
      }
      console.log('new Worker(new URL("./worker", import.meta.url))')
      const worker = new Worker(new URL(/* worker import */ __webpack_require__.p + __webpack_require__.u("worker_js"), __webpack_require__.b))
      worker.postMessage('Hello from background!')
      const messageFromWorker = await new Promise((resolve, reject) => {
        worker.onerror = reject
        worker.onmessage = (event) => {
          resolve(event.data)
        }
      })
      ;(0,_util_js__WEBPACK_IMPORTED_MODULE_0__.test)(messageFromWorker === 'Hello from worker!', messageFromWorker)
    })
  )
  .then(() => {
    setInterval(() => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => chrome.tabs.sendMessage(tab.id, 'Hello from background!'))
      })
    }, 1000)
    chrome.runtime.onMessage.addListener((message) => {
      console.log('Message from content script:', message)
    })
  })

})();

/******/ })()

/******/ } catch (e) {
/******/ 	Promise.reject(e);
/******/ };