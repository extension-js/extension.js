//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  openDevWatchSession
} from './helpers/dev-watch-session'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// A real rspack watch over a worker that injects a TypeScript file, which
// the runtime trace compiles in a child of its own.
const tempFolder = trackTempFolders()

interface BuildRecord {
  childCompiles: number
  output: Record<string, string>
  watched: string[]
  watchedFor: string[]
  warnings: string[]
  errors: string[]
}

interface Watched {
  root: string
  builds: BuildRecord[]
  // The first build that compiled the write.
  after: (write: () => void) => Promise<BuildRecord>
  close: () => Promise<void>
}

const workerSource = (note: string) =>
  `chrome.action.onClicked.addListener((tab) => {\n  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['inject/tool.js']})\n})\nconsole.log('${note}')\n`

// A classic file that ends on a value, which executeScript resolves with.
const toolSource = (note: string) =>
  `import {dep} from './dep'\nconst found: string = dep + '${note}'\nfound\n`

const depSource = (value: string) => `export const dep = '${value}'\n`

async function watchProject(): Promise<Watched> {
  const root = writeExtensionProject(tempFolder('extjs-traced-compile-'), {
    manifest: {
      permissions: ['scripting', 'activeTab'],
      action: {},
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    },
    files: {
      'background.js': workerSource('worker 0'),
      'inject/tool.ts': toolSource(''),
      'inject/dep.ts': depSource('dep-one'),
      'content.js': 'console.log("content 0")\n'
    }
  })
  const builds: BuildRecord[] = []
  const relative = (files: Iterable<string>) =>
    [...files]
      .filter((file) => file.startsWith(root))
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
  const session: DevWatchSession = await openDevWatchSession(
    root,
    'chrome',
    (compiler: Compiler) => {
      compiler.hooks.done.tap('spec', ({compilation}) => {
        const output: Record<string, string> = {}

        for (const asset of compilation.getAssets()) {
          if (asset.name.startsWith('inject/')) {
            output[asset.name] = String(asset.source.source())
          }
        }

        builds.push({
          childCompiles: compilation.children.length,
          output,
          watched: relative(compilation.fileDependencies),
          watchedFor: relative(compilation.missingDependencies),
          warnings: [...compilation.warnings].map((warning) =>
            String((warning as Error).name)
          ),
          errors: [...compilation.errors].map((error) =>
            String((error as Error).message)
          )
        })
      })
    }
  )

  await session.settle()

  return {
    root,
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

describe('a file the runtime trace compiles, across rebuilds', () => {
  let project: Watched
  const write = (file: string, contents: string) =>
    fs.writeFileSync(path.join(project.root, file), contents)

  beforeAll(async () => {
    project = await watchProject()
  }, 120000)

  afterAll(async () => {
    await project?.close()
  })

  it('compiles the file in the first build and keeps the value it ends on', () => {
    const [first] = project.builds

    expect(first.childCompiles).toBe(1)
    expect(first.errors).toEqual([])
    expect(Object.keys(first.output)).toContain('inject/tool.js')
    expect(first.output['inject/tool.js']).toContain('dep-one')
    // The block a later step closes an injected file on, told by this one.
    expect(first.output['inject/tool.js']).toContain('__extjsCompletionValue')
  })

  it('ships the same file without compiling it when another file changed', async () => {
    const [first] = project.builds
    const rebuild = await project.after(() =>
      write('content.js', 'console.log("content 1")\n')
    )

    expect(rebuild.childCompiles).toBe(0)
    expect(rebuild.output).toEqual(first.output)
    expect(rebuild.watched).toEqual(
      expect.arrayContaining(['inject/tool.ts', 'inject/dep.ts'])
    )

    expect([...rebuild.watchedFor].sort()).toEqual([...first.watchedFor].sort())
    expect(rebuild.warnings).toEqual(first.warnings)
    expect(rebuild.errors).toEqual([])
  })

  it('ships the same file without compiling it when the script that names it changed', async () => {
    const [first] = project.builds
    const rebuild = await project.after(() =>
      write('background.js', workerSource('worker 1'))
    )

    expect(rebuild.childCompiles).toBe(0)
    expect(rebuild.output).toEqual(first.output)
  })

  it('compiles the file again when a file it imports changed', async () => {
    const rebuild = await project.after(() =>
      write('inject/dep.ts', depSource('dep-two'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.output['inject/tool.js']).toContain('dep-two')
    expect(rebuild.output['inject/tool.js']).not.toContain('dep-one')
  })

  it('compiles the file again when the file itself changed', async () => {
    const rebuild = await project.after(() =>
      write('inject/tool.ts', toolSource('tool-two'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.output['inject/tool.js']).toContain('tool-two')
  })

  it('reports an import that went missing, on that rebuild and the next', async () => {
    const kept = await project.after(() =>
      write('content.js', 'console.log("content 2")\n')
    )
    expect(kept.childCompiles).toBe(0)

    const rebuild = await project.after(() =>
      fs.rmSync(path.join(project.root, 'inject/dep.ts'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.errors.join('\n')).toContain('./dep')
    expect(rebuild.watchedFor).toContain('inject/dep.ts')

    const next = await project.after(() =>
      write('content.js', 'console.log("content 3")\n')
    )

    expect(next.childCompiles).toBe(1)
    expect(next.errors.join('\n')).toContain('./dep')
  })

  it('rebuilds and compiles the file again once the import is back', async () => {
    // The only write: the build watches for what the last compile missed.
    const rebuild = await project.after(() =>
      write('inject/dep.ts', depSource('dep-three'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.errors).toEqual([])
    expect(rebuild.output['inject/tool.js']).toContain('dep-three')
  })

  it('rebuilds and compiles the file again when a file it looked for and missed appears', async () => {
    const kept = await project.after(() =>
      write('content.js', 'console.log("content 4")\n')
    )
    expect(kept.childCompiles).toBe(0)

    // The resolver takes dep.js over dep.ts, and a kept compile watches for it.
    const rebuild = await project.after(() =>
      write('inject/dep.js', depSource('dep-from-js'))
    )

    expect(rebuild.childCompiles).toBe(1)
    expect(rebuild.output['inject/tool.js']).toContain('dep-from-js')
  })
})
