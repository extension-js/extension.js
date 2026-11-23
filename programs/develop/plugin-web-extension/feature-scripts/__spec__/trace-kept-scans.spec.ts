import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {writeProjectFiles} from '../../../__spec__/helpers/extension-project'
import {asCompiler, type TapCallback} from '../../__spec__/helpers/rspack-fakes'
import {TraceRuntimeLoadedFiles} from '../steps/trace-runtime-loaded-files'

type EmittedAsset = {name: string; source: {source(): string | Buffer}}

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

function createTempProject(
  files: Record<string, string>,
  manifest: Record<string, unknown> = {}
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-kept-'))
  tempDirs.push(dir)
  writeProjectFiles(dir, {
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'fixture',
      ...manifest
    }),
    ...files
  })

  return dir
}

// One step instance fed build after build, as a watching compiler feeds it.
function session(projectDir: string, watching = true) {
  const scanned: string[] = []
  let start: TapCallback | undefined
  const compiler = {
    watchMode: watching,
    options: {entry: {}, mode: watching ? 'development' : 'production'},
    hooks: {
      thisCompilation: {
        tap: (_name: string, fn: TapCallback) => {
          start = fn
        }
      }
    }
  }

  new TraceRuntimeLoadedFiles({
    manifestPath: path.join(projectDir, 'manifest.json'),
    onScan: (assetName, scan) => scanned.push(`${assetName} ${scan}`)
  }).apply(asCompiler(compiler))

  return {
    compiler,
    async build(hash: string, assets: Record<string, string>) {
      const emitted = new Map<string, EmittedAsset>(
        Object.entries(assets).map(([name, text]) => [
          name,
          {name, source: {source: () => text}}
        ])
      )
      let done: unknown
      const compilation = {
        hash,
        warnings: [] as Error[],
        errors: [] as Error[],
        fileDependencies: new Set<string>(),
        modules: [],
        getAsset: (name: string) => emitted.get(name),
        getAssets: () => Array.from(emitted.values()),
        emitAsset: (name: string, source: EmittedAsset['source']) => {
          emitted.set(name, {name, source})
        },
        updateAsset: (name: string, source: EmittedAsset['source']) => {
          emitted.set(name, {name, source})
        },
        hooks: {
          processAssets: {
            tapPromise: (_options: unknown, fn: TapCallback) => {
              done = fn()
            }
          }
        }
      }

      scanned.length = 0
      start?.(compilation)
      await done

      return {
        scans: [...scanned],
        // The scripts this build read, each named once.
        scanned: [...new Set(scanned.map((line) => line.split(' ')[0]))].sort(),
        shipped: [...emitted.keys()].filter((name) => !(name in assets)).sort(),
        text: (name: string) => emitted.get(name)?.source.source().toString(),
        warnings: compilation.warnings.map((warning) => warning.message)
      }
    }
  }
}

const WORKER = 'background/service_worker.js'
const PAGE = 'action/index.js'
const HASH_1 = '261c8d6364031501'
const HASH_2 = 'e2595228ed40d5e8'
// What the bundler leaves in every development entry.
const runtimeOf = (hash: string) => `__webpack_require__.h=()=>("${hash}");\n`

describe('scans kept from one build to the next', () => {
  it('reads again only the script an edit changed', async () => {
    const dir = createTempProject({
      'data/a.json': '{}',
      'data/b.json': '{}',
      'data/c.json': '{}'
    })
    const {build} = session(dir)
    const worker = `${runtimeOf(HASH_1)}fetch("../data/a.json")`

    const first = await build(HASH_1, {
      [WORKER]: worker,
      [PAGE]: 'fetch("../data/b.json")'
    })

    expect(first.scanned).toEqual([PAGE, WORKER])
    expect(first.shipped).toEqual(['data/a.json', 'data/b.json'])

    const second = await build(HASH_1, {
      [WORKER]: worker,
      [PAGE]: 'fetch("../data/c.json")'
    })

    expect(second.scanned).toEqual([PAGE])
    expect(second.shipped).toEqual(['data/a.json', 'data/c.json'])
  })

  it('reads no script whose only change is the build hash', async () => {
    const dir = createTempProject({'data/a.json': '{}'})
    const {build} = session(dir)
    const body =
      'fetch("../data/a.json");chrome.runtime.getURL("gone/missing.png")'

    const first = await build(HASH_1, {[WORKER]: runtimeOf(HASH_1) + body})
    const second = await build(HASH_2, {[WORKER]: runtimeOf(HASH_2) + body})

    expect(first.scanned).toEqual([WORKER])
    expect(second.scanned).toEqual([])
    expect(second.shipped).toEqual(first.shipped)
    expect(second.shipped).toEqual(['data/a.json'])
    expect(second.warnings).toEqual(first.warnings)
    expect(second.warnings).toHaveLength(1)
  })

  it('reads again a script whose answer holds the build hash', async () => {
    const dir = createTempProject({
      [`data/${HASH_1}.json`]: '{}',
      [`data/${HASH_2}.json`]: '{}'
    })
    const {build} = session(dir)
    const worker = (hash: string) => `fetch("../data/${hash}.json")`

    const first = await build(HASH_1, {[WORKER]: worker(HASH_1)})
    const second = await build(HASH_2, {[WORKER]: worker(HASH_2)})

    expect(first.shipped).toEqual([`data/${HASH_1}.json`])
    expect(second.shipped).toEqual([`data/${HASH_2}.json`])
  })

  it('reads again a script the build hash moved in', async () => {
    const dir = createTempProject({'background/a.json': '{}'})
    const {build} = session(dir)

    // The hash glued to the call makes another word of it, so no file is
    // fetched. Both texts are the same once the hash is taken out.
    const first = await build(HASH_1, {[WORKER]: `${HASH_1}fetch("a.json")`})
    const second = await build(HASH_2, {[WORKER]: `fetch("a.json")${HASH_2}`})

    expect(first.shipped).toEqual([])
    expect(second.shipped).toEqual(['background/a.json'])
  })

  it('takes a hash that is not hex digits as part of the text', async () => {
    const dir = createTempProject({'data/a.json': '{}'})
    const {build} = session(dir)
    const body = 'fetch("../data/a.json")'

    await build('fetch+open/1', {
      [WORKER]: `${runtimeOf('fetch+open/1')}${body}`
    })

    const second = await build('fetch+open/2', {
      [WORKER]: `${runtimeOf('fetch+open/2')}${body}`
    })

    expect(second.scanned).toEqual([WORKER])
  })

  it('forgets a script the build stopped emitting', async () => {
    const dir = createTempProject({'data/a.json': '{}', 'data/b.json': '{}'})
    const {build} = session(dir)
    const assets = {
      [WORKER]: 'fetch("../data/a.json")',
      [PAGE]: 'fetch("../data/b.json")'
    }

    await build(HASH_1, assets)
    const without = await build(HASH_1, {[WORKER]: assets[WORKER]})
    const back = await build(HASH_1, assets)

    expect(without.scanned).toEqual([])
    expect(back.scanned).toEqual([PAGE])
    expect(back.shipped).toEqual(['data/a.json', 'data/b.json'])
  })

  it('forgets the old text of a script that kept its name', async () => {
    const dir = createTempProject({'data/a.json': '{}'})
    const {build} = session(dir)
    const text = 'fetch("../data/a.json")'

    await build(HASH_1, {[WORKER]: text})
    await build(HASH_1, {[WORKER]: `${text};`})
    const back = await build(HASH_1, {[WORKER]: text})

    expect(back.scanned).toEqual([WORKER])
  })

  it('forgets the old name of a script named by its content', async () => {
    const dir = createTempProject({'data/a.json': '{}'})
    const {build} = session(dir)
    const text = 'chrome.runtime.getURL("data/a.json")'

    await build(HASH_1, {'content_scripts/content-0.c4baf0ce.js': text})
    await build(HASH_1, {'content_scripts/content-0.f4d3cebf.js': `${text};`})
    const back = await build(HASH_1, {
      'content_scripts/content-0.c4baf0ce.js': text
    })

    expect(back.scanned).toEqual(['content_scripts/content-0.c4baf0ce.js'])
  })

  it('reads a script again once the trace rewrote it, and then no more', async () => {
    const dir = createTempProject(
      {'ui/popup.html': '', 'ui/near.html': '<p>near</p>'},
      {action: {default_popup: 'ui/popup.html'}}
    )
    const {build} = session(dir)
    const assets = {
      'action/index.html': '<script src="/action/index.js"></script>',
      [PAGE]: 'chrome.tabs.create({url:"./near.html"})'
    }

    const first = await build(HASH_1, assets)
    const second = await build(HASH_1, assets)

    // Once as the bundler wrote it, once with the path the page moved to.
    expect(
      first.scans.filter((scan) => scan === `${PAGE} surfaces`)
    ).toHaveLength(2)

    expect(first.text(PAGE)).toContain('"/ui/near.html"')
    expect(second.scanned).toEqual([])
    expect(second.text(PAGE)).toBe(first.text(PAGE))
    expect(second.shipped).toEqual(first.shipped)
  })

  it('keeps nothing for a compiler that builds once', async () => {
    const dir = createTempProject({'data/a.json': '{}'})
    const {build} = session(dir, false)
    const assets = {[WORKER]: 'fetch("../data/a.json")'}

    await build(HASH_1, assets)
    const second = await build(HASH_1, assets)

    expect(second.scanned).toEqual([WORKER])
    expect(second.shipped).toEqual(['data/a.json'])
  })

  it('reads a changed copy again, from disk and for what it names', async () => {
    const dir = createTempProject({
      'data/a.json': '{"build":1}',
      'lib/helper.js': 'self.helper = 1'
    })
    const {build} = session(dir)
    const assets = {
      [WORKER]: 'fetch("../data/a.json");chrome.runtime.getURL("lib/helper.js")'
    }

    const first = await build(HASH_1, assets)

    fs.writeFileSync(path.join(dir, 'data/a.json'), '{"build":2}')
    fs.writeFileSync(
      path.join(dir, 'lib/helper.js'),
      'self.helper = 2;chrome.runtime.getURL("lib/more.js")'
    )

    fs.writeFileSync(path.join(dir, 'lib/more.js'), 'self.more = 1')

    const second = await build(HASH_1, assets)

    expect(first.text('data/a.json')).toBe('{"build":1}')
    expect(first.scanned).toEqual([WORKER, 'lib/helper.js'])
    expect(second.scanned).toEqual(['lib/helper.js', 'lib/more.js'])
    expect(second.text('data/a.json')).toBe('{"build":2}')
    expect(second.shipped).toEqual([
      'data/a.json',
      'lib/helper.js',
      'lib/more.js'
    ])
  })
})

describe('the scripts of one build', () => {
  it('reads a script the trace copied for the paths it names', async () => {
    const dir = createTempProject({
      'lib/helper.js': 'const table = {icon: "images/on.png"}',
      'images/on.png': 'png'
    })
    const {build} = session(dir)

    const {shipped} = await build(HASH_1, {
      [WORKER]: 'fetch("x");chrome.runtime.getURL("lib/helper.js")'
    })

    expect(shipped).toEqual(['images/on.png', 'lib/helper.js'])
  })

  it('reads a script once however many phases ask', async () => {
    const dir = createTempProject({'data/a.json': '{}'})
    const scans: string[] = []
    let start: TapCallback | undefined
    let done: unknown
    const text = 'fetch("../data/a.json")'
    const emitted = new Map<string, EmittedAsset>([
      [WORKER, {name: WORKER, source: {source: () => text}}]
    ])

    new TraceRuntimeLoadedFiles({
      manifestPath: path.join(dir, 'manifest.json'),
      onScan: (_assetName, scan) => scans.push(scan)
    }).apply(
      asCompiler({
        options: {entry: {}, mode: 'production'},
        hooks: {
          thisCompilation: {
            tap: (_name: string, fn: TapCallback) => {
              start = fn
            }
          }
        }
      })
    )

    start?.({
      warnings: [],
      errors: [],
      fileDependencies: new Set<string>(),
      modules: [],
      getAsset: (name: string) => emitted.get(name),
      getAssets: () => Array.from(emitted.values()),
      emitAsset: (name: string, source: EmittedAsset['source']) => {
        emitted.set(name, {name, source})
      },
      hooks: {
        processAssets: {
          tapPromise: (_options: unknown, fn: TapCallback) => {
            done = fn()
          }
        }
      }
    })

    await done

    expect(scans.length).toBeGreaterThan(0)
    expect(new Set(scans).size).toBe(scans.length)
  })
})
