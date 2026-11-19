import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  openDevWatchSession
} from '../../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../../__spec__/helpers/temp-folders'

// A real rspack watch over a page that names a script and a stylesheet that
// do not exist when the session starts. Both are left out of the page entry,
// and an entry cannot grow while the compiler runs.
const tempFolder = trackTempFolders()
let root = ''
let session: DevWatchSession

const write = (name: string, contents: string) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
  fs.writeFileSync(path.join(root, name), contents)
}

async function saveAndRebuild(name: string, contents: string) {
  const seen = await session.settle()
  write(name, contents)

  return session.doneAfter(seen, 10000)
}

const errorsOf = (stats: {compilation: {errors: unknown}}) =>
  Array.from(stats.compilation.errors as Iterable<Error>).map((error) => ({
    name: error.name,
    message: String(error.message)
  }))

beforeAll(async () => {
  root = fs.realpathSync(tempFolder('extjs-page-late-'))

  write(
    'package.json',
    JSON.stringify({private: true, name: 'page-late', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'page-late',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'}
    })
  )

  write(
    'popup/index.html',
    '<!doctype html><html><head><link rel="stylesheet" href="./late.css"></head><body><script src="./main.js"></script><script src="./late.js"></script></body></html>\n'
  )

  write('popup/main.js', "console.log('ok')\n")

  session = await openDevWatchSession(root)
}, 120000)

afterAll(async () => {
  await session?.close()
})

describe('a page file that is created after the session started', () => {
  it('says a restart is needed when the missing script appears', async () => {
    const stats = await saveAndRebuild('popup/late.js', "console.log('late')\n")
    const errors = errorsOf(stats)

    expect(errors.map((error) => error.name)).toEqual(['HtmlEntrypointChanged'])
    expect(errors[0].message).toContain(
      `FILE ${path.join(root, 'popup', 'late.js')}`
    )

    expect(errors[0].message).toContain('Restart the dev server')
  }, 60000)

  it('says it again for the stylesheet, and only for the file that is new', async () => {
    const stats = await saveAndRebuild('popup/late.css', 'body{color:red}\n')
    const errors = errorsOf(stats)

    expect(errors.map((error) => error.name)).toEqual(['HtmlEntrypointChanged'])
    expect(errors[0].message).toContain(
      `FILE ${path.join(root, 'popup', 'late.css')}`
    )

    expect(errors[0].message).not.toContain('late.js')
  }, 60000)
})
