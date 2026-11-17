import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession,
  waitUntil
} from '../../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../../__spec__/helpers/temp-folders'

// A real rspack watch over a page that names an image, a stylesheet and a
// script. Each test saves one file and waits for the rebuild that save owes.
const tempFolder = trackTempFolders()
let root = ''
let session: DevWatchSession

const image = (fill: number) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(4096, fill)
  ])

const page = (heading: string) =>
  `<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><h1>${heading}</h1><img src="./logo.png"><img src="./later.png"><script src="./main.js"></script></body></html>\n`

const write = (name: string, contents: string | Buffer) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
  fs.writeFileSync(path.join(root, name), contents)
}

// Static assets ship under a content-hashed name, so the output is searched
// for the bytes and not for a file name.
const shipped = (bytes: Buffer) => {
  const assets = path.join(session.distPath, 'assets')
  if (!fs.existsSync(assets)) return false

  return fs
    .readdirSync(assets)
    .some((name) => fs.readFileSync(path.join(assets, name)).equals(bytes))
}

const shippedPage = () => {
  try {
    return fs.readFileSync(
      path.join(session.distPath, 'action/index.html'),
      'utf8'
    )
  } catch {
    return ''
  }
}

// Saves one file and returns the rebuild that follows, or fails after ten
// seconds when the watcher never heard about the file.
async function saveAndRebuild(name: string, contents: string | Buffer) {
  const seen = await session.settle()
  write(name, contents)

  return session.doneAfter(seen, 10000)
}

beforeAll(async () => {
  root = fs.realpathSync(tempFolder('extjs-page-refs-'))

  write(
    'package.json',
    JSON.stringify({private: true, name: 'page-refs', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'page-refs',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'}
    })
  )

  write('popup/index.html', page('one'))
  write('popup/style.css', 'body{color:red}\n')
  write('popup/main.js', "console.log('ok')\n")
  write('popup/logo.png', image(1))

  session = await openDevWatchSession(root)
}, 120000)

afterAll(async () => {
  await session?.close()
})

describe('watching the files a page references', () => {
  it('rebuilds and ships the new bytes when a referenced image is rewritten', async () => {
    await waitUntil(() => shipped(image(1)))
    expect(shipped(image(1))).toBe(true)

    const stats = await saveAndRebuild('popup/logo.png', image(2))

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(() => shipped(image(2)), 10000)
    expect(shipped(image(2))).toBe(true)
  }, 60000)

  it('rebuilds when a referenced file that did not exist is created', async () => {
    expect(shipped(image(3))).toBe(false)

    const stats = await saveAndRebuild('popup/later.png', image(3))

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(() => shipped(image(3)), 10000)
    expect(shipped(image(3))).toBe(true)
  }, 60000)

  it('keeps watching the page and its files while the build has an error', async () => {
    const broken = await saveAndRebuild('popup/main.js', "console.log('ok' \n")

    expect(errorsOf(broken).length).toBeGreaterThan(0)

    // The page is the file a fix may edit, so its save must still rebuild.
    const pageSave = await saveAndRebuild('popup/index.html', page('two'))

    expect(errorsOf(pageSave).length).toBeGreaterThan(0)

    const imageSave = await saveAndRebuild('popup/logo.png', image(4))

    expect(errorsOf(imageSave).length).toBeGreaterThan(0)

    const fixed = await saveAndRebuild('popup/main.js', "console.log('ok')\n")

    expect(errorsOf(fixed)).toEqual([])
    await waitUntil(
      () => shippedPage().includes('<h1>two</h1>') && shipped(image(4)),
      10000
    )

    expect(shippedPage()).toContain('<h1>two</h1>')
    expect(shipped(image(4))).toBe(true)
  }, 90000)
})
