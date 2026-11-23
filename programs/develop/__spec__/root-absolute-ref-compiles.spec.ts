import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {buildSourceFeatureIndex} from '../plugin-reload/classify-reload'
import {
  type DevWatchSession,
  openDevWatchSession
} from './helpers/dev-watch-session'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// A real rspack watch over a popup whose module script is named from the
// extension root, which the build compiles in a child of its own.
const tempFolder = trackTempFolders()

interface BuildRecord {
  childCompiles: number
  output: Record<string, string>
  watched: string[]
  warnings: string[]
  errors: string[]
  // The sources the reload classifier ties to a content script.
  contentSources: string[]
}

interface Watched {
  root: string
  session: DevWatchSession
  builds: BuildRecord[]
  // The first build that compiled the write.
  after: (write: () => void) => Promise<BuildRecord>
  close: () => Promise<void>
}

const LATE_WARNING = 'SpecLateWarning'

const popupPage = (ref: string) =>
  `<!doctype html><html><head><script type="module" src="${ref}"></script></head><body></body></html>\n`

const moduleSource = (imports: string) =>
  `import {dep} from './dep.js'\n${imports}console.log(dep)\n`

const depSource = (value: string) => `export const dep = '${value}'\n`

async function watchProject(
  files: Record<string, string>,
  ref = '/lib/mod.js'
): Promise<Watched> {
  const root = writeExtensionProject(tempFolder('extjs-root-ref-compile-'), {
    manifest: {
      action: {default_popup: 'popup.html'},
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    },
    files: {
      'popup.html': popupPage(ref),
      'lib/mod.js': moduleSource(''),
      'lib/dep.js': depSource('dep-one'),
      'background.js': 'console.log("background")\n',
      'content.js': 'console.log("content 0")\n',
      ...files
    }
  })
  const builds: BuildRecord[] = []
  const session = await openDevWatchSession(
    root,
    'chrome',
    (compiler: Compiler) => {
      // A warning from a later stage, so the place of an earlier one shows.
      compiler.hooks.thisCompilation.tap('spec', (compilation) => {
        compilation.hooks.processAssets.tap(
          {name: 'spec', stage: Compilation.PROCESS_ASSETS_STAGE_REPORT},
          () => {
            const late = new WebpackError('said late')

            late.name = LATE_WARNING
            compilation.warnings.push(late)
          }
        )
      })

      compiler.hooks.done.tap('spec', ({compilation}) => {
        const output: Record<string, string> = {}

        for (const asset of compilation.getAssets()) {
          if (/^(?:lib|content_scripts)\/(?:mod|helper)\.js/.test(asset.name)) {
            output[asset.name] = String(asset.source.source())
          }
        }

        builds.push({
          childCompiles: compilation.children.length,
          output,
          watched: [...compilation.fileDependencies]
            .filter((file) => file.startsWith(root))
            .map((file) => path.relative(root, file).split(path.sep).join('/')),
          warnings: [...compilation.warnings].map((warning) =>
            String((warning as Error).name)
          ),
          errors: [...compilation.errors].map((error) =>
            String((error as Error).message)
          ),
          contentSources: [
            ...buildSourceFeatureIndex(
              compilation,
              root
            ).contentEntriesBySource.keys()
          ]
        })
      })
    }
  )

  await session.settle()

  return {
    root,
    session,
    builds,
    async after(write) {
      const seen = await session.settle()

      write()
      await session.doneAfter(seen)
      await session.settle()

      return builds[seen]
    },
    close: () => session.close()
  }
}

describe('a file a root-absolute ref compiles, across rebuilds', () => {
  let project: Watched
  const write = (file: string, contents: string) =>
    fs.writeFileSync(path.join(project.root, file), contents)

  beforeAll(async () => {
    project = await watchProject({})
  }, 120000)

  afterAll(async () => {
    await project?.close()
  })

  it('compiles the file in the first build', () => {
    const [first] = project.builds

    expect(first.childCompiles).toBe(1)
    expect(first.output['lib/mod.js']).toContain('dep-one')
    expect(Object.keys(first.output).sort()).toEqual([
      'lib/mod.js',
      'lib/mod.js.map'
    ])

    expect(first.errors).toEqual([])
  })

  it('ships the same file without compiling it when another file changed', async () => {
    const [first] = project.builds
    const rebuild = await project.after(() =>
      write('content.js', 'console.log("content 1")\n')
    )

    expect(rebuild.childCompiles).toBe(0)
    expect(rebuild.output).toEqual(first.output)
    expect(rebuild.watched).toEqual(
      expect.arrayContaining(['lib/mod.js', 'lib/dep.js'])
    )

    expect(rebuild.warnings).toEqual(first.warnings)
    expect(rebuild.errors).toEqual([])
  })

  it('compiles the file again when a file it imports changed', async () => {
    const rebuild = await project.after(() =>
      write('lib/dep.js', depSource('dep-two'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.output['lib/mod.js']).toContain('dep-two')
    expect(rebuild.output['lib/mod.js']).not.toContain('dep-one')
  })

  it('compiles the file again when the file itself changed', async () => {
    const rebuild = await project.after(() =>
      write('lib/mod.js', `${moduleSource('')}console.log('mod-two')\n`)
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.output['lib/mod.js']).toContain('mod-two')
  })

  it('reports an import that went missing instead of shipping the old file', async () => {
    const kept = await project.after(() =>
      write('content.js', 'console.log("content 2")\n')
    )
    expect(kept.childCompiles).toBe(0)

    const rebuild = await project.after(() =>
      fs.rmSync(path.join(project.root, 'lib/dep.js'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.errors.join('\n')).toContain('./dep.js')
  })

  it('reports a failing file again on each rebuild', async () => {
    const rebuild = await project.after(() =>
      write('content.js', 'console.log("content 3")\n')
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.errors.join('\n')).toContain('./dep.js')
  })

  it('rebuilds and compiles the file again once the import is back', async () => {
    // The only write: the build watches for what the last compile missed.
    const rebuild = await project.after(() =>
      write('lib/dep.js', depSource('dep-three'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.errors).toEqual([])
    expect(rebuild.output['lib/mod.js']).toContain('dep-three')
  })

  it('rebuilds and compiles the file again when a file it looked for and missed appears', async () => {
    const kept = await project.after(() =>
      write('content.js', 'console.log("content 4")\n')
    )
    expect(kept.childCompiles).toBe(0)

    // The resolver takes dep.ts over dep.js, and a kept compile watches for it.
    const rebuild = await project.after(() =>
      write('lib/dep.ts', depSource('dep-from-ts'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.output['lib/mod.js']).toContain('dep-from-ts')

    const without = await project.after(() =>
      fs.rmSync(path.join(project.root, 'lib/dep.ts'))
    )

    expect(without.output['lib/mod.js']).toContain('dep-three')
  })

  it('stops shipping a deleted file and compiles it when it returns', async () => {
    const gone = await project.after(() =>
      fs.rmSync(path.join(project.root, 'lib/mod.js'))
    )

    expect(gone.childCompiles).toBe(0)
    expect(gone.output).toEqual({})

    // The only write: the build watches for a file a page names and misses.
    const back = await project.after(() =>
      write('lib/mod.js', moduleSource(''))
    )

    expect(back.childCompiles).toBe(1)
    expect(back.output['lib/mod.js']).toContain('dep-three')
  })

  it('warns about a bad ref an edited page gains, in a rebuild that compiles nothing', async () => {
    const rebuild = await project.after(() =>
      write(
        'popup.html',
        popupPage('/lib/mod.js').replace(
          '<body>',
          '<body><img src="/.env.local">'
        )
      )
    )

    expect(rebuild.childCompiles).toBe(0)
    expect(rebuild.output['lib/mod.js']).toContain('dep-three')
    expect(rebuild.warnings.length).toBeGreaterThan(1)
  })
})

describe('what a child compile says for the build around it', () => {
  let project: Watched

  beforeAll(async () => {
    project = await watchProject({
      'background.js':
        'try { require("not-installed-one") } catch {}\nconsole.log("background")\n'
    })
  }, 120000)

  afterAll(async () => {
    await project?.close()
  })

  it('lands in the same place when the child compile is skipped', async () => {
    const [first] = project.builds

    // The first build compiles the child, which says the pending warning.
    expect(first.childCompiles).toBe(1)
    expect(first.warnings).toEqual([
      'UnresolvedBareRequireWarning',
      LATE_WARNING
    ])

    const write = (file: string, contents: string) =>
      fs.writeFileSync(path.join(project.root, file), contents)

    // A child that carried a warning is not kept, so this one compiles.
    await project.after(() => write('content.js', 'console.log("content 1")\n'))

    const rebuild = await project.after(() =>
      write(
        'background.js',
        'try { require("not-installed-two") } catch {}\nconsole.log("background")\n'
      )
    )

    expect(rebuild.childCompiles).toBe(0)
    expect(rebuild.warnings).toEqual(first.warnings)
  })
})

describe('a child compile the reload classifier reads', () => {
  let project: Watched

  beforeAll(async () => {
    project = await watchProject(
      {
        'content_scripts/helper.js': moduleSource(''),
        'content_scripts/dep.js': depSource('dep-one')
      },
      '/content_scripts/helper.js'
    )
  }, 120000)

  afterAll(async () => {
    await project?.close()
  })

  it('runs on every rebuild, so its sources stay known', async () => {
    const [first] = project.builds
    const rebuild = await project.after(() =>
      fs.writeFileSync(
        path.join(project.root, 'content.js'),
        'console.log("content 1")\n'
      )
    )

    expect(first.contentSources).toContain('content_scripts/helper.js')
    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.contentSources).toEqual(first.contentSources)
  })
})
