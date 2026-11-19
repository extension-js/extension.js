import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession,
  waitUntil
} from '../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {outputHolding} from './helpers/private-files-project'

// A real rspack watch over a popup, one session per row. The row deletes a
// file the page names, lets the failed build settle, then writes it back.
const tempFolder = trackTempFolders()
const FIRST = 'page-file-first-text'
const SECOND = 'page-file-second-text'
const SIBLING = 'page-file-sibling-text'
let session: DevWatchSession | undefined

const page = (head: string, body: string) =>
  `<!doctype html><html><head>${head}</head><body><h1>popup</h1>${body}</body></html>\n`

const script = (mark: string) => `console.log("${mark}")\n`
const moduleScript = (mark: string) => `console.log("${mark}")\nexport {}\n`
const sheet = (mark: string) => `body::after{content:"${mark}"}\n`

const CASES = [
  {
    title: "the page's only script",
    html: page('', '<script src="./popup.js"></script>'),
    target: 'popup.js',
    contents: script,
    others: {},
    output: 'action/index.js',
    kept: []
  },
  {
    title: 'one of two module scripts',
    html: page(
      '',
      '<script type="module" src="./popup.js"></script><script type="module" src="./keep.js"></script>'
    ),
    target: 'popup.js',
    contents: moduleScript,
    others: {'keep.js': moduleScript(SIBLING)},
    output: 'action/index.js',
    kept: ['action/index.js']
  },
  {
    title: "the page's only stylesheet",
    html: page('<link rel="stylesheet" href="./popup.css">', ''),
    target: 'popup.css',
    contents: sheet,
    others: {},
    output: 'action/index.css',
    kept: []
  }
] as const

function makeProject(files: Record<string, string>): string {
  const root = fs.realpathSync(tempFolder('extjs-page-file-back-'))

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'page-file-back', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'page-file-back',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), contents)
  }

  return root
}

// The shipped code and sheets that hold a text. Source maps and hot update
// chunks repeat the source, so they are left out.
const shippedHolding = (root: string, text: string) =>
  outputHolding(root, text).filter(
    (name) => !name.endsWith('.map') && !name.startsWith('hot/')
  )

// Every local file the shipped popup names, and the ones missing from dist.
function shippedRefs(distPath: string) {
  const html = fs.readFileSync(path.join(distPath, 'action/index.html'), 'utf8')
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
    (match) => match[1]
  )

  return {
    refs,
    missing: refs.filter((ref) => !fs.existsSync(path.join(distPath, ref)))
  }
}

afterEach(async () => {
  await session?.close()
  session = undefined
})

describe('a file a page names, deleted and written back in a watch session', () => {
  it.each(CASES)('rebuilds $title with the text it came back with', async ({
    html,
    target,
    contents,
    others,
    output,
    kept
  }) => {
    const root = makeProject({
      'popup.html': html,
      [target]: contents(FIRST),
      ...others
    })
    const watching = await openDevWatchSession(root)

    session = watching

    const beforeDelete = await watching.settle()

    expect(shippedHolding(root, FIRST)).toEqual([output])
    fs.rmSync(path.join(root, target))

    const gone = await watching.doneAfter(beforeDelete)

    expect(errorsOf(gone)).toHaveLength(1)
    expect(errorsOf(gone)[0]).toContain(path.join(root, target))

    // The failed build is left to settle, so the write lands on a session
    // that has given up on the file.
    const beforeWrite = await watching.settle()
    fs.writeFileSync(path.join(root, target), contents(SECOND))
    await waitUntil(() => shippedHolding(root, SECOND).length > 0, 30000)

    expect(shippedHolding(root, SECOND)).toEqual([output])
    expect(shippedHolding(root, FIRST)).toEqual([])
    expect(shippedHolding(root, SIBLING)).toEqual(kept)
    expect(shippedRefs(watching.distPath).refs).toContain(`/${output}`)
    expect(shippedRefs(watching.distPath).missing).toEqual([])
    expect(errorsOf(await watching.doneAfter(beforeWrite))).toEqual([])
  }, 120000)
})
