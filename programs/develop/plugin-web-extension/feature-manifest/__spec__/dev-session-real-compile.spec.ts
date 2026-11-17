import * as fs from 'node:fs'
import {createRequire, syncBuiltinESMExports} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {suppressManifestOutputWrites} from '../../../dev-server'
import {devAdditionsOf} from '../../../lib/dev-additions'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  manifest: Record<string, unknown>,
  files: Record<string, string>
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-manifest-dev-session-'))
  )
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'dev-session', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({name: 'dev-session', version: '1.0.0', ...manifest})
  )

  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), text)
  }

  return root
}

interface DevSession {
  distPath: string
  first: Stats
  save(file: string, text: string): Promise<Stats>
  close(): Promise<void>
}

// The watch a dev session runs, with no browser and no server around it.
async function devSession(
  root: string,
  tap: (compiler: Compiler) => void = () => {}
): Promise<DevSession> {
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: distPath}
  } as never)
  config.plugins = (config.plugins || []).filter(
    (plugin) => plugin?.constructor.name !== 'plugin-browsers'
  )

  config.plugins.push(new rspack.HotModuleReplacementPlugin())
  config.stats = false

  const compiler: Compiler = rspack(config)
  const release = suppressManifestOutputWrites(
    compiler,
    path.join(distPath, 'manifest.json')
  )
  tap(compiler)

  let finished: ((stats: Stats) => void) | undefined
  const nextBuild = () =>
    new Promise<Stats>((resolve) => {
      finished = resolve
    })
  const firstBuild = nextBuild()
  const watching = compiler.watch({aggregateTimeout: 20}, (_error, stats) => {
    const done = finished
    finished = undefined
    if (stats) done?.(stats)
  })
  const first = await firstBuild
  // The watcher needs its baseline before a save counts as a change.
  await new Promise((resolve) => setTimeout(resolve, 300))

  return {
    distPath,
    first,
    save(file, text) {
      const build = nextBuild()
      fs.writeFileSync(path.join(root, file), text)

      return build
    },
    async close() {
      await new Promise<void>((resolve) => watching.close(() => resolve()))
      release()
    }
  }
}

const CONTENT_SCRIPT_PROJECT = {
  manifest: {
    manifest_version: 3,
    background: {service_worker: 'background.js'},
    content_scripts: [{matches: ['https://example.com/*'], js: ['content.js']}]
  },
  files: {
    'background.js': 'console.log("background")\n',
    'content.js': 'import {label} from "./label.js"\nconsole.log(label)\n',
    'label.js': 'export const label = "one"\n'
  }
}

function contentScriptFiles(distPath: string): string[] {
  const folder = path.join(distPath, 'content_scripts')

  return fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []
}

describe('the content script files of a dev session', () => {
  it('keeps the last build on disk until the next one is written, then drops it', async () => {
    const root = project(
      CONTENT_SCRIPT_PROJECT.manifest,
      CONTENT_SCRIPT_PROJECT.files
    )
    const beforeWrite: string[][] = []
    const session = await devSession(root, (compiler) => {
      // Asset processing is over here and no file of this build is written.
      compiler.hooks.emit.tap('spec:before-write', (compilation) => {
        beforeWrite.push(
          contentScriptFiles(String(compilation.options.output.path))
        )
      })
    })

    try {
      expect(session.first.hasErrors()).toBe(false)
      const afterFirst = contentScriptFiles(session.distPath)
      const firstBundle = afterFirst.find((name) =>
        /^content-0\.[a-f0-9]+\.js$/.test(name)
      )

      expect(firstBundle).toBeDefined()

      const second = await session.save(
        'label.js',
        'export const label = "two"\n'
      )
      const afterSecond = contentScriptFiles(session.distPath)
      const emitted = second.compilation
        .getAssets()
        .map((asset) => asset.name)
        .filter((name) => name.startsWith('content_scripts/'))
        .map((name) => name.slice('content_scripts/'.length))
        .sort()

      expect(second.hasErrors()).toBe(false)
      // The manifest and the registry on disk still name the first build's
      // files while the second one is being put together.
      expect(beforeWrite[1]).toEqual(afterFirst)
      expect(afterSecond).not.toContain(firstBundle)
      expect(afterSecond).toEqual(emitted)
    } finally {
      await session.close()
    }
  }, 120_000)
})
