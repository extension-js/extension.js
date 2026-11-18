import fs from 'node:fs'
import * as path from 'node:path'

// A fixture written just before the compiler starts watching reads as changed,
// either by an mtime inside the first scan's accuracy or by a late FS event.

export async function settleFixture(root: string, timeoutMs = 10000) {
  const past = new Date(Date.now() - 60_000)

  for (const entry of fs.readdirSync(root, {recursive: true})) {
    fs.utimesSync(path.join(root, String(entry)), past, past)
  }

  fs.utimesSync(root, past, past)

  // FS events reach watchers in the order they happened, so once this marker's
  // event arrives no fixture event is left to reach a watcher started later.
  const markerDir = fs.mkdtempSync(`${root}-settle-`)
  const watcher = fs.watch(markerDir)
  let rewrite: NodeJS.Timeout | undefined

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`no FS event for the marker in ${timeoutMs} ms`)),
        timeoutMs
      )

      watcher.on('change', (_type, name) => {
        if (String(name) !== 'marker') return

        clearTimeout(timer)
        resolve()
      })

      watcher.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })

      // The event stream can start after fs.watch returns and miss one write.
      const write = () => fs.writeFileSync(path.join(markerDir, 'marker'), '')
      write()
      rewrite = setInterval(write, 100)
    })
  } finally {
    clearInterval(rewrite)
    watcher.close()
    fs.rmSync(markerDir, {recursive: true, force: true})
  }
}
