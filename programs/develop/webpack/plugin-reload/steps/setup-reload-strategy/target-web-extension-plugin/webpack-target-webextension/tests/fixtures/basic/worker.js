import { log, test } from './util.js'

let event
addEventListener('message', (e) => (event = e))

Promise.resolve()
  .then(
    log('Worker Test A: import.meta.url', () => {
      const url = new URL('./test.txt', import.meta.url).toString()
      test(url.includes('-extension://'), "new URL('./test.txt', import.meta.url)\n", url)
    })
  )
  .then(
    log('Worker Test B: dynamic import', async () => {
      console.log("await import('./log.js')\n")
      const mod = await import('./log.js')
      test('file' in mod, mod)
    })
  )
  .then(() => new Promise((resolve) => setTimeout(resolve, 100)))
  .then(
    log('Worker Test C: message from background', () => {
      test(event?.data === 'Hello from background!', event.data)
    })
  )
  .finally(() => {
    postMessage('Hello from worker!')
  })
