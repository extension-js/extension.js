import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import {
  browserProfileRootDir,
  eventsPath,
  readyContractPath
} from '../../lib/session-paths'
import webpackConfig from '../../rspack-config'
import {withSessionStartPrune} from '../session-start-prune'

const roots: string[] = []

function scaffold() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-start-prune-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'start-prune', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'start-prune',
      version: '0.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>'
  )

  writePopup(root, "console.log('start-prune-marker')\n")

  return root
}

function writePopup(root: string, source: string) {
  fs.writeFileSync(path.join(root, 'popup.js'), source)
}

function plant(file: string, text = 'left by an earlier session') {
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, text)

  return file
}

async function makeCompiler(
  root: string,
  session: {isRestart: boolean; outputPath?: string}
) {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: session.outputPath || distPath}
  } as never)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  return rspack(
    withSessionStartPrune(config, {
      isRestart: session.isRestart,
      distPath,
      readyPath: readyContractPath(root, 'chrome')
    })
  )
}

type Outcome = {hasErrors: boolean}

function watchSession(compiler: Compiler) {
  const dones: Outcome[] = []
  compiler.hooks.done.tap('spec-start-prune', (stats) => {
    dones.push({hasErrors: stats.hasErrors()})
  })

  const watching = compiler.watch({}, () => {})
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

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

describe('the browser folder after the first compile of a dev session', () => {
  it('holds only what that compile emitted and leaves its neighbours alone', async () => {
    const root = scaffold()
    const dist = path.join(root, 'dist', 'chrome')
    const stale = plant(path.join(dist, 'deleted-between-sessions.txt'))
    const staleBundle = plant(
      path.join(dist, 'content_scripts', 'content-0.0badc0de.js')
    )
    const events = plant(eventsPath(root, 'chrome'), '{"type":"shutdown"}\n')
    const profile = plant(
      path.join(browserProfileRootDir(root, 'chrome'), 'dev', 'Preferences')
    )
    const otherBrowser = plant(
      path.join(root, 'dist', 'firefox', 'manifest.json')
    )

    const session = watchSession(await makeCompiler(root, {isRestart: false}))

    try {
      await session.untilDone(passed)

      expect(fs.existsSync(stale)).toBe(false)
      expect(fs.existsSync(staleBundle)).toBe(false)
      expect(fs.existsSync(path.join(dist, 'content_scripts'))).toBe(false)
      expect(
        fs.readFileSync(path.join(dist, 'action', 'index.js'), 'utf-8')
      ).toContain('start-prune-marker')

      expect(fs.existsSync(path.join(dist, 'manifest.json'))).toBe(true)
      expect(fs.readFileSync(events, 'utf-8')).toBe('{"type":"shutdown"}\n')
      expect(fs.existsSync(profile)).toBe(true)
      expect(fs.existsSync(otherBrowser)).toBe(true)
    } finally {
      await session.close()
    }
  }, 120_000)

  it('keeps the previous build while the first compile fails, then prunes once it passes', async () => {
    const root = scaffold()
    const dist = path.join(root, 'dist', 'chrome')
    const previousBuild = plant(path.join(dist, 'action', 'index.js'))
    const stale = plant(path.join(dist, 'deleted-between-sessions.txt'))
    writePopup(root, "console.log('broken'\n")

    const session = watchSession(await makeCompiler(root, {isRestart: false}))

    try {
      await session.untilDone(failed)
      expect(fs.readFileSync(previousBuild, 'utf-8')).toBe(
        'left by an earlier session'
      )

      expect(fs.existsSync(stale)).toBe(true)

      const edited = session.seen()
      const fix = () => writePopup(root, "console.log('start-prune-fixed')\n")
      fix()
      await session.untilDone(passed, edited, fix)
      expect(fs.readFileSync(previousBuild, 'utf-8')).toContain(
        'start-prune-fixed'
      )

      expect(fs.existsSync(stale)).toBe(false)
    } finally {
      await session.close()
    }
  }, 120_000)

  it('prunes once per session start, never on a later compile', async () => {
    const root = scaffold()
    const dist = path.join(root, 'dist', 'chrome')
    const session = watchSession(await makeCompiler(root, {isRestart: false}))

    try {
      await session.untilDone(passed)
      const openTabChunk = plant(path.join(dist, 'chunk-an-open-tab-reads.js'))
      const edited = session.seen()
      const edit = () => writePopup(root, "console.log('start-prune-edit')\n")
      edit()
      await session.untilDone(
        (outcome) =>
          passed(outcome) &&
          fs
            .readFileSync(path.join(dist, 'action', 'index.js'), 'utf-8')
            .includes('start-prune-edit'),
        edited,
        edit
      )

      expect(fs.existsSync(openTabChunk)).toBe(true)
    } finally {
      await session.close()
    }
  }, 120_000)

  it('keeps every file when the session rebuilds its compiler', async () => {
    const root = scaffold()
    const dist = path.join(root, 'dist', 'chrome')
    const first = watchSession(await makeCompiler(root, {isRestart: false}))
    await first.untilDone(passed)
    const openTabChunk = plant(path.join(dist, 'chunk-an-open-tab-reads.js'))
    const restarted = await makeCompiler(root, {isRestart: true})
    await first.close()
    const second = watchSession(restarted)

    try {
      await second.untilDone(passed)

      expect(fs.existsSync(openTabChunk)).toBe(true)
      expect(fs.existsSync(path.join(dist, 'manifest.json'))).toBe(true)
    } finally {
      await second.close()
    }
  }, 120_000)

  it('keeps every file while another live dev session owns the target', async () => {
    const root = scaffold()
    const dist = path.join(root, 'dist', 'chrome')
    const openTabChunk = plant(path.join(dist, 'chunk-an-open-tab-reads.js'))

    plant(
      readyContractPath(root, 'chrome'),
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        pid: process.ppid,
        runId: 'the-other-session'
      })
    )

    const session = watchSession(await makeCompiler(root, {isRestart: false}))

    try {
      await session.untilDone(passed)

      expect(fs.existsSync(openTabChunk)).toBe(true)
      expect(fs.existsSync(path.join(dist, 'manifest.json'))).toBe(true)
    } finally {
      await session.close()
    }
  }, 120_000)

  it('prunes after a session that ended and left its ready contract behind', async () => {
    const root = scaffold()
    const dist = path.join(root, 'dist', 'chrome')
    const stale = plant(path.join(dist, 'deleted-between-sessions.txt'))

    plant(
      readyContractPath(root, 'chrome'),
      JSON.stringify({
        command: 'dev',
        status: 'stopped',
        pid: process.ppid,
        runId: 'the-ended-session'
      })
    )

    const session = watchSession(await makeCompiler(root, {isRestart: false}))

    try {
      await session.untilDone(passed)

      expect(fs.existsSync(stale)).toBe(false)
      expect(fs.existsSync(path.join(dist, 'manifest.json'))).toBe(true)
    } finally {
      await session.close()
    }
  }, 120_000)

  it('never touches a folder the project config re-pointed the output to', async () => {
    const root = scaffold()
    const custom = path.join(root, 'custom-output')
    const authorFile = plant(path.join(custom, 'kept-by-the-author.txt'))

    const session = watchSession(
      await makeCompiler(root, {isRestart: false, outputPath: custom})
    )

    try {
      await session.untilDone(passed)

      expect(fs.existsSync(authorFile)).toBe(true)
      expect(fs.existsSync(path.join(custom, 'manifest.json'))).toBe(true)
    } finally {
      await session.close()
    }
  }, 120_000)
})
