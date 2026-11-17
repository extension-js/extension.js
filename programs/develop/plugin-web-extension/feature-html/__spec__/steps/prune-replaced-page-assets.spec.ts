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

// A real rspack watch over a page that names two images, one of which its
// stylesheet names too. A watch session never cleans its output folder, so
// what each save leaves in dist is read from disk.
const tempFolder = trackTempFolders()
let root = ''
let session: DevWatchSession

const image = (fill: number) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(4096, fill)
  ])

const page = (...images: string[]) =>
  `<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body>${images
    .map((name) => `<img src="./${name}">`)
    .join('')}<script src="./main.js"></script></body></html>\n`

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

async function saveAndRebuild(name: string, contents: string | Buffer) {
  const seen = await session.settle()
  write(name, contents)

  return session.doneAfter(seen, 10000)
}

beforeAll(async () => {
  root = fs.realpathSync(tempFolder('extjs-page-prune-'))

  write(
    'package.json',
    JSON.stringify({private: true, name: 'page-prune', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'page-prune',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'}
    })
  )

  write('popup/index.html', page('logo.png', 'shared.png'))
  write('popup/style.css', 'body{background:url(./shared.png)}\n')
  write('popup/main.js', "console.log('ok')\n")
  write('popup/logo.png', image(1))
  write('popup/shared.png', image(50))

  session = await openDevWatchSession(root)
}, 120000)

afterAll(async () => {
  await session?.close()
})

describe('the copies of a page file a dev session leaves in dist', () => {
  it('removes the copy a rewritten image replaced', async () => {
    await waitUntil(() => shipped(image(1)))
    expect(shipped(image(1))).toBe(true)

    const stats = await saveAndRebuild('popup/logo.png', image(2))

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(() => shipped(image(2)) && !shipped(image(1)), 10000)
    expect(shipped(image(2))).toBe(true)
    expect(shipped(image(1))).toBe(false)
  }, 60000)

  it('keeps the copies when the build has an error, and removes them once it passes', async () => {
    const broken = await saveAndRebuild('popup/main.js', "console.log('ok' \n")

    expect(errorsOf(broken).length).toBeGreaterThan(0)

    await saveAndRebuild('popup/logo.png', image(3))
    expect(shipped(image(2))).toBe(true)

    const fixed = await saveAndRebuild('popup/main.js', "console.log('ok')\n")

    expect(errorsOf(fixed)).toEqual([])
    await waitUntil(() => shipped(image(3)) && !shipped(image(2)), 10000)
    expect(shipped(image(3))).toBe(true)
    expect(shipped(image(2))).toBe(false)
  }, 90000)

  it('removes the copy of an image the page stopped naming, unless a stylesheet still names it', async () => {
    const stats = await saveAndRebuild('popup/index.html', page())

    expect(errorsOf(stats)).toEqual([])
    await waitUntil(() => !shipped(image(3)), 10000)
    expect(shipped(image(3))).toBe(false)
    expect(shipped(image(50))).toBe(true)
  }, 60000)
})
