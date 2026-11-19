import * as fs from 'node:fs'
import {createRequire, syncBuiltinESMExports} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {devAdditionsOf} from '../../../lib/dev-additions'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'
import {writeOutputAsADevSessionDoes} from './helpers/dev-output-writes'

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
  const release = writeOutputAsADevSessionDoes(compiler, distPath)
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

describe('the source scans of a dev session', () => {
  const cjsFs = createRequire(import.meta.url)('node:fs') as typeof fs

  it('read each project module from disk once per save', async () => {
    const root = project(CONTENT_SCRIPT_PROJECT.manifest, {
      ...CONTENT_SCRIPT_PROJECT.files,
      'background.js':
        'import {shared} from "./shared.js"\nconsole.log(shared)\n',
      'shared.js': 'export const shared = "one"\n'
    })
    const reads = new Map<string, number>()
    const realRead = cjsFs.readFileSync
    let counting = false

    cjsFs.readFileSync = function (this: unknown, ...args: unknown[]) {
      const file = args[0]

      if (
        counting &&
        typeof file === 'string' &&
        path.dirname(file) === root &&
        file.endsWith('.js') &&
        // Other plugins scan the same modules, and those are not counted.
        /[\\/]feature-manifest[\\/]steps[\\/]/.test(String(new Error().stack))
      ) {
        const name = path.basename(file)
        reads.set(name, (reads.get(name) || 0) + 1)
      }

      return Reflect.apply(realRead, this, args)
    } as typeof fs.readFileSync

    syncBuiltinESMExports()

    const session = await devSession(root)

    try {
      counting = true
      await session.save('shared.js', 'export const shared = "two"\n')
      const afterOneSave = Object.fromEntries(reads)
      await session.save('shared.js', 'export const shared = "three"\n')
      counting = false

      expect(afterOneSave).toEqual({
        'background.js': 1,
        'content.js': 1,
        'label.js': 1,
        'shared.js': 1
      })

      expect(Object.fromEntries(reads)).toEqual({
        'background.js': 2,
        'content.js': 2,
        'label.js': 2,
        'shared.js': 2
      })
    } finally {
      cjsFs.readFileSync = realRead
      syncBuiltinESMExports()
      await session.close()
    }
  }, 120_000)
})

describe('the dev additions a dev session records', () => {
  function manifestChanges(stats: Stats): string[] {
    return (devAdditionsOf(stats.compilation) || [])
      .filter((entry) => entry.kind === 'manifest_change')
      .map((entry) => entry.value)
  }

  it('names the looser policy, the opened connect list and the kept background', async () => {
    const session = await devSession(
      project(
        {
          manifest_version: 2,
          background: {scripts: ['background.js'], persistent: false},
          externally_connectable: {matches: ['https://example.com/*']}
        },
        {'background.js': 'console.log("background")\n'}
      )
    )

    try {
      expect(session.first.hasErrors()).toBe(false)
      expect(manifestChanges(session.first)).toEqual([
        "content_security_policy 'unsafe-eval'",
        'externally_connectable.ids *',
        'background.persistent true'
      ])

      const written = JSON.parse(
        fs.readFileSync(path.join(session.distPath, 'manifest.json'), 'utf8')
      )

      expect(written.content_security_policy).toContain("'unsafe-eval'")
      expect(written.externally_connectable.ids).toEqual(['*'])
      expect(written.background.persistent).toBe(true)
    } finally {
      await session.close()
    }
  }, 120_000)

  it('names the background it adds to a manifest that declares none', async () => {
    const session = await devSession(
      project(
        {
          manifest_version: 3,
          action: {default_popup: 'popup.html'}
        },
        {'popup.html': '<!doctype html><html><body>popup</body></html>\n'}
      )
    )

    try {
      expect(session.first.hasErrors()).toBe(false)
      expect(manifestChanges(session.first)).toEqual([
        'background.service_worker background/service_worker.js'
      ])
    } finally {
      await session.close()
    }
  }, 120_000)

  it('names none of them for a manifest dev leaves as it is', async () => {
    const session = await devSession(
      project(
        {manifest_version: 3, background: {service_worker: 'background.js'}},
        {'background.js': 'console.log("background")\n'}
      )
    )

    try {
      expect(manifestChanges(session.first)).toEqual([])
    } finally {
      await session.close()
    }
  }, 120_000)
})
