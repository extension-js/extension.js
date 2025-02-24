"use strict";
(self["webpackChunk"] = self["webpackChunk"] || []).push([["background"],{

/***/ "./background.js":
/*!***********************!*\
  !*** ./background.js ***!
  \***********************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

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
  .then(
    (0,_util_js__WEBPACK_IMPORTED_MODULE_0__.log)('Test D: new Worker()', async () => {
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


/***/ })

},
/******/ __webpack_require__ => { // webpackRuntimeModules
/******/ var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
/******/ __webpack_require__.O(0, ["test_txt-util_js"], () => (__webpack_exec__("./background.js")));
/******/ var __webpack_exports__ = __webpack_require__.O();
/******/ }
]);