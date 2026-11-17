import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {devWatchOptions} from '../../__spec__/helpers/dev-watch-options'
import {getProjectStructure} from '../../lib/project'
import {
  browserProfileRootDir,
  eventsPath,
  readyContractPath
} from '../../lib/session-paths'
import webpackConfig from '../../rspack-config'
import {withGoneEntryOutputsPruned} from '../session-gone-outputs'
import {withSessionStartPrune} from '../session-start-prune'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

type ManifestShape = Record<string, unknown>

const FULL: ManifestShape = {
  background: {service_worker: 'background.js'},
  action: {default_popup: 'popup.html'},
  options_ui: {page: 'options.html'},
  content_scripts: [
    {matches: ['https://example.com/*'], js: ['content-a.js']},
    {
      matches: ['https://example.org/*'],
      js: ['content-b.js'],
      css: ['content-b.css']
    }
  ]
}

function writeManifest(root: string, shape: ManifestShape, version = 3) {
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: version,
      name: 'gone-outputs',
      version: '0.0.0',
      ...shape
    })
  )
}

function scaffold(browser: string) {
  // A real path: the session and the checks below name one spelling.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), `extjs-gone-outputs-${browser}-`))
  )

  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), text)
  }

  roots.push(root)
  write(
    'package.json',
    JSON.stringify({private: true, name: 'gone-outputs', version: '0.0.0'})
  )

  write('background.js', "console.log('background')\n")
  write('content-a.js', "console.log('content a')\n")
  write('content-b.js', "console.log('content b')\n")
  write('content-b.css', 'body { outline: 1px solid red }\n')
  write(
    'popup.html',
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>'
  )

  write('popup.js', "console.log('popup')\n")
  write(
    'options.html',
    '<!doctype html><html><head><link rel="stylesheet" href="./options.css"></head><body><script src="./options.js"></script></body></html>'
  )

  write('options.js', "console.log('options')\n")
  write('options.css', 'body { margin: 0 }\n')
  write('pages/extra.html', '<!doctype html><html><body>extra</body></html>')
  write('public/data.json', '{"kept":true}\n')
  writeManifest(root, FULL)

  return root
}

function plant(file: string, text = 'not written by the session') {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, text)

  return file
}

async function makeCompiler(
  root: string,
  browser: string,
  session: {isRestart: boolean; written: Set<string>}
) {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', browser)
  const config = webpackConfig(projectStructure, {
    browser,
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath}
  } as never)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  // The same two wrappers, in the order the dev server applies them.
  return rspack(
    withGoneEntryOutputsPruned(
      withSessionStartPrune(config, {
        isRestart: session.isRestart,
        distPath,
        readyPath: readyContractPath(root, browser)
      }),
      {isRestart: session.isRestart, distPath, written: session.written}
    )
  )
}

type Outcome = {hasErrors: boolean}

function watchSession(compiler: Compiler) {
  const dones: Outcome[] = []

  compiler.hooks.done.tap('spec-gone-outputs', (stats) => {
    dones.push({hasErrors: stats.hasErrors()})
  })

  const watching = compiler.watch(devWatchOptions(compiler), () => {})
  const untilDone = (
    accept: (outcome: Outcome) => boolean,
    from = 0,
    edit?: () => void
  ) =>
    new Promise<Outcome>((resolve, reject) => {
      const startedAt = Date.now()
      let editedAt = Date.now()

      const poll = () => {
        const match = dones.slice(from).find(accept)
        if (match) return resolve(match)

        if (edit && Date.now() - editedAt > 2000) {
          editedAt = Date.now()
          edit()
        }

        if (Date.now() - startedAt > 30000) {
          return reject(
            new Error(
              `no accepted compile within 30s, ${dones.length} seen, last ${JSON.stringify(dones.at(-1))}`
            )
          )
        }

        setTimeout(poll, 25)
      }

      poll()
    })

  return {
    untilDone,
    seen: () => dones.length,
    close: () => new Promise<void>((resolve) => watching.close(() => resolve()))
  }
}

const passed = (outcome: Outcome) => !outcome.hasErrors
const failed = (outcome: Outcome) => outcome.hasErrors

function shipped(dist: string): string[] {
  return fs
    .readdirSync(dist, {recursive: true})
    .map((file) => String(file).split(path.sep).join('/'))
    .filter((file) => fs.statSync(path.join(dist, file)).isFile())
    .filter((file) => !file.endsWith('.map') && !file.includes('.hot-update.'))
    .sort()
}

// One compiler until its first good compile, as a session start or a restart.
async function compileOnce(
  root: string,
  browser: string,
  session: {isRestart: boolean; written: Set<string>}
) {
  const watch = watchSession(await makeCompiler(root, browser, session))

  try {
    await watch.untilDone(passed)
  } finally {
    await watch.close()
  }

  return shipped(path.join(root, 'dist', browser))
}

describe('the browser folder after a dev session restart', () => {
  for (const browser of ['chrome', 'firefox']) {
    it(`${browser}: drops the outputs of entries the restart no longer has`, async () => {
      const root = scaffold(browser)
      const dist = path.join(root, 'dist', browser)
      const written = new Set<string>()
      const before = await compileOnce(root, browser, {
        isRestart: false,
        written
      })

      expect(before).toEqual(
        expect.arrayContaining([
          'action/index.html',
          'action/index.js',
          'options/index.html',
          'options/index.js',
          'options/index.css',
          'content_scripts/content-1.css',
          'pages/extra.html',
          'data.json'
        ])
      )

      // None of these was written by the session.
      const foreign = plant(path.join(dist, 'notes', 'kept.txt'))
      const events = plant(eventsPath(root, browser), '{"type":"compile"}\n')
      const profile = plant(
        path.join(browserProfileRootDir(root, browser), 'dev', 'Preferences')
      )
      const otherBrowser = plant(
        path.join(root, 'dist', 'another-browser', 'options', 'index.js')
      )

      writeManifest(root, {
        background: FULL.background,
        content_scripts: [(FULL.content_scripts as unknown[])[0]]
      })

      fs.rmSync(path.join(root, 'pages', 'extra.html'))

      const after = await compileOnce(root, browser, {isRestart: true, written})

      for (const gone of [
        'action/index.html',
        'action/index.js',
        'options/index.html',
        'options/index.js',
        'options/index.css',
        'content_scripts/content-1.css',
        'pages/extra.html'
      ]) {
        expect(after, gone).not.toContain(gone)
      }

      expect(fs.existsSync(path.join(dist, 'options'))).toBe(false)
      expect(fs.existsSync(path.join(dist, 'action'))).toBe(false)
      expect(after).toEqual(
        expect.arrayContaining([
          'manifest.json',
          'background/service_worker.js',
          'data.json',
          'notes/kept.txt'
        ])
      )

      expect(fs.existsSync(foreign)).toBe(true)
      expect(fs.readFileSync(events, 'utf-8')).toBe('{"type":"compile"}\n')
      expect(fs.existsSync(profile)).toBe(true)
      expect(fs.existsSync(otherBrowser)).toBe(true)

      // What is left is what a session started on this project would write.
      const fresh = scaffold(browser)

      writeManifest(fresh, {
        background: FULL.background,
        content_scripts: [(FULL.content_scripts as unknown[])[0]]
      })

      fs.rmSync(path.join(fresh, 'pages', 'extra.html'))

      const expected = await compileOnce(fresh, browser, {
        isRestart: false,
        written: new Set()
      })

      // A dev content script name carries a hash of its project path.
      const unhashed = (files: string[]) =>
        files.map((file) => file.replace(/\.[0-9a-f]{8}\./, '.[hash].'))

      expect(
        unhashed(after.filter((file) => file !== 'notes/kept.txt'))
      ).toEqual(unhashed(expected))
    }, 180_000)
  }

  it('drops background/scripts.js once the script is a service worker', async () => {
    const root = scaffold('firefox')
    const dist = path.join(root, 'dist', 'firefox')
    const written = new Set<string>()

    writeManifest(root, {background: {scripts: ['background.js']}}, 2)

    const before = await compileOnce(root, 'firefox', {
      isRestart: false,
      written
    })

    expect(before).toContain('background/scripts.js')

    writeManifest(root, {background: {service_worker: 'background.js'}})

    const after = await compileOnce(root, 'firefox', {isRestart: true, written})

    expect(after).toContain('background/service_worker.js')
    expect(after).not.toContain('background/scripts.js')
    expect(fs.readdirSync(path.join(dist, 'background'))).toEqual(
      expect.arrayContaining(['service_worker.js'])
    )
  }, 180_000)

  it('keeps a file a public/ source still stands behind', async () => {
    const root = scaffold('chrome')
    const dist = path.join(root, 'dist', 'chrome')
    const written = new Set<string>()

    await compileOnce(root, 'chrome', {isRestart: false, written})
    writeManifest(root, {background: FULL.background})
    await compileOnce(root, 'chrome', {isRestart: true, written})

    expect(fs.readFileSync(path.join(dist, 'data.json'), 'utf-8')).toBe(
      '{"kept":true}\n'
    )

    expect([...written]).not.toContain('data.json')
  }, 180_000)

  it('keeps every output while the restart compile fails, then drops the gone ones', async () => {
    const root = scaffold('chrome')
    const dist = path.join(root, 'dist', 'chrome')
    const written = new Set<string>()

    await compileOnce(root, 'chrome', {isRestart: false, written})
    writeManifest(root, {background: FULL.background})
    fs.writeFileSync(path.join(root, 'background.js'), "console.log('broken'\n")

    const watch = watchSession(
      await makeCompiler(root, 'chrome', {isRestart: true, written})
    )

    try {
      await watch.untilDone(failed)
      expect(fs.existsSync(path.join(dist, 'options', 'index.js'))).toBe(true)
      expect(fs.existsSync(path.join(dist, 'action', 'index.html'))).toBe(true)

      const edited = watch.seen()
      const fix = () =>
        fs.writeFileSync(
          path.join(root, 'background.js'),
          "console.log('fixed')\n"
        )

      fix()
      await watch.untilDone(passed, edited, fix)

      expect(fs.existsSync(path.join(dist, 'options'))).toBe(false)
      expect(fs.existsSync(path.join(dist, 'action'))).toBe(false)
    } finally {
      await watch.close()
    }
  }, 180_000)

  it('removes nothing on a rebuild that is not a restart', async () => {
    const root = scaffold('chrome')
    const dist = path.join(root, 'dist', 'chrome')
    const written = new Set<string>(['options/index.js', 'left/over.js'])
    const leftover = plant(path.join(dist, 'left', 'over.js'))
    const watch = watchSession(
      await makeCompiler(root, 'chrome', {isRestart: true, written})
    )

    try {
      await watch.untilDone(passed)

      // The restart compile is the one that drops what is gone.
      expect(fs.existsSync(leftover)).toBe(false)

      const replanted = plant(leftover)
      const edited = watch.seen()
      const edit = () =>
        fs.writeFileSync(
          path.join(root, 'popup.js'),
          `console.log('popup ${Date.now()}')\n`
        )

      written.add('left/over.js')
      edit()
      await watch.untilDone(passed, edited, edit)

      expect(fs.existsSync(replanted)).toBe(true)
    } finally {
      await watch.close()
    }
  }, 180_000)
})
