import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {
  answerSessionRestarts,
  type DevSessionRestartRequest
} from '../lib/session-restart-signal'
import {
  type DevWatchSession,
  openDevWatchSession
} from './helpers/dev-watch-session'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// A real rspack watch over a project that names a file from the extension
// root which no folder holds yet. public/ answers for that name once there.
const tempFolder = trackTempFolders()
const sessions: DevWatchSession[] = []

// A loaded machine can take most of a minute for one watch compile.
const COMPILE_DEADLINE_MS = 120000

const slashed = (file: string) => file.split(path.sep).join('/')

const popupNaming = (ref: string) =>
  `<!doctype html><html><head><script src="${ref}"></script></head><body></body></html>\n`

const workerNaming = (file: string) =>
  `chrome.action.onClicked.addListener((tab) => {\n  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['${file}']})\n})\n`

interface BuildRecord {
  assets: string[]
  warnings: string[]
}

async function watchProject(
  manifestFile: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>
) {
  const root = writeExtensionProject(tempFolder('extjs-root-ref-public-'), {
    manifest,
    manifestFile,
    files
  })
  const builds: BuildRecord[] = []

  const open = async () => {
    const session = await openDevWatchSession(
      root,
      'chrome',
      (compiler: Compiler) => {
        compiler.hooks.done.tap('spec', ({compilation}) => {
          builds.push({
            assets: compilation.getAssets().map((asset) => slashed(asset.name)),
            warnings: [...compilation.warnings].map((warning) =>
              String((warning as Error).name)
            )
          })
        })
      }
    )
    sessions.push(session)
    await session.doneAfter(0, COMPILE_DEADLINE_MS)

    return session
  }

  const session = await open()

  return {
    root,
    session,
    builds,
    open,
    // The last build after a write, once the watcher is quiet again.
    async after(write: () => void) {
      const seen = await session.settle()

      write()
      await session.doneAfter(seen, COMPILE_DEADLINE_MS)
      await session.settle()

      return builds[builds.length - 1]
    }
  }
}

const writeUnder = (folder: string, file: string, contents: string) => {
  fs.mkdirSync(folder, {recursive: true})
  fs.writeFileSync(path.join(folder, file), contents)
}

const shippedText = (session: DevWatchSession, file: string) => {
  const shipped = path.join(session.distPath, file)

  return fs.existsSync(shipped) ? fs.readFileSync(shipped, 'utf8') : undefined
}

afterAll(async () => {
  for (const session of sessions) await session.close()
})

describe('a file named from the extension root that later appears under public/', () => {
  it.each([
    ['at the project root', 'manifest.json', 'public'],
    ['next to a manifest in src/', 'src/manifest.json', 'src/public']
  ])(
    'rebuilds and ships the file a page names, with public/ %s',
    async (_name, manifestFile, publicFolder) => {
      const manifestDir = path.dirname(manifestFile)
      const project = await watchProject(
        manifestFile,
        {action: {default_popup: 'popup.html'}},
        {
          [path.posix.join(manifestDir, 'popup.html')]: popupNaming('/x.js'),
          [`${publicFolder}/other.txt`]: 'other\n'
        }
      )
      const [first] = project.builds

      expect(first.assets).not.toContain('x.js')
      expect(first.warnings).toContain('HtmlEntrypointMissing')
      expect(shippedText(project.session, 'x.js')).toBeUndefined()

      // The only write: no page, script or manifest changes with it.
      const rebuild = await project.after(() =>
        writeUnder(
          path.join(project.root, publicFolder),
          'x.js',
          'console.log("from-public")\n'
        )
      )

      expect(rebuild.assets).toContain('x.js')
      expect(rebuild.warnings).not.toContain('HtmlEntrypointMissing')
      expect(shippedText(project.session, 'x.js')).toContain('from-public')
    },
    180000
  )

  it('rebuilds and ships the file a worker names', async () => {
    const project = await watchProject(
      'manifest.json',
      {
        permissions: ['scripting', 'activeTab'],
        action: {},
        background: {service_worker: 'background.js'}
      },
      {
        'background.js': workerNaming('x.js'),
        'public/other.txt': 'other\n'
      }
    )
    const [first] = project.builds

    expect(first.assets).not.toContain('x.js')
    expect(first.warnings).toContain('InjectedScriptFilesMissing')

    // The only write: the worker that names the file stays as it was.
    const rebuild = await project.after(() =>
      writeUnder(
        path.join(project.root, 'public'),
        'x.js',
        'console.log("from-public")\n'
      )
    )

    expect(rebuild.assets).toContain('x.js')
    expect(rebuild.warnings).not.toContain('InjectedScriptFilesMissing')
    expect(shippedText(project.session, 'x.js')).toContain('from-public')
  }, 180000)

  it('asks the session to restart when public/ itself is new, and ships after it', async () => {
    const asked: DevSessionRestartRequest[] = []
    // Stands in for the dev server, which answers these for a live session.
    const before = answerSessionRestarts({
      request: (_compiler, request) => {
        asked.push(request)

        return true
      },
      isRestarting: () => false
    })

    try {
      const project = await watchProject(
        'manifest.json',
        {action: {default_popup: 'popup.html'}},
        {'popup.html': popupNaming('/x.js')}
      )
      const publicDir = path.join(project.root, 'public')

      // The only write: the folder and the file in it arrive together.
      await project.after(() =>
        writeUnder(publicDir, 'x.js', 'console.log("from-public")\n')
      )

      expect(
        asked.map((request) => [
          request.reason,
          slashed(String(request.pathAfter))
        ])
      ).toContainEqual(['public', slashed(publicDir)])

      // A restart is a new compiler over the same project.
      await project.session.close()
      const restarted = await project.open()

      expect(project.builds[project.builds.length - 1].warnings).not.toContain(
        'HtmlEntrypointMissing'
      )

      expect(shippedText(restarted, 'x.js')).toContain('from-public')
    } finally {
      answerSessionRestarts(before)
    }
  }, 180000)
})
