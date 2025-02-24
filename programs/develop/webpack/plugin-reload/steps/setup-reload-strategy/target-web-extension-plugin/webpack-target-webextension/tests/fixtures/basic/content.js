/// <reference lib="dom" />
// @ts-check

import { log, test } from './util.js'

Promise.resolve()
  .then(
    log('Test A: import.meta.url', () => {
      const url = new URL('./test.txt', import.meta.url).toString()
      test(url.includes('-extension://'), "new URL('./test.txt', import.meta.url)\n", url)
    })
  )
  .then(
    log('Test B: __webpack_public_path__', () => {
      test(__webpack_public_path__.includes('-extension://'), '__webpack_public_path__\n', __webpack_public_path__)
    })
  )
  .then(
    log('Test C: dynamic import', async () => {
      console.log("await import('./log.js')\n")
      const mod = await import('./log.js')
      test('file' in mod, mod)
    })
  )
  .then(() => {
    chrome.runtime.sendMessage('Hello from content script!')
    chrome.runtime.onMessage.addListener((message) => {
      console.log('Message from background:', message)
    })
  })
