import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {afterEach, describe, expect, it} from 'vitest'
import {
  compileIssues,
  idleCompiler,
  tapsAddedBy,
  writeProject
} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {diagnosticCode} from '../../lib/diagnostic-code'
import {WebExtensionPlugin} from '../../plugin-web-extension'
import {SetupChunkLoadingTarget} from '../../plugin-web-extension/feature-chunk-loading'
import type {BrowserType} from '../../types'
import {ReloadPlugin} from '../index'
import {SetupBackgroundEntry} from '../steps/setup-reload-strategy/setup-background-entry'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

function writeManifest(manifest: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-bg-'))
  tempDirs.push(dir)
  const manifestPath = path.join(dir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8')

  return manifestPath
}

type StepBrowser = ConstructorParameters<
  typeof SetupBackgroundEntry
>[0]['browser']

function fakeCompiler(entry: Record<string, unknown> = {}) {
  const compilationTaps: Array<(compilation: {errors: Error[]}) => void> = []
  const compiler = {
    options: {entry},
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (compilation: {errors: Error[]}) => void) => {
          compilationTaps.push(cb)
        }
      }
    }
  } as unknown as Compiler & {
    // The fake's entry is the plain object the step writes into.
    options: {entry: Record<string, unknown>}
    __collectErrors: () => Error[]
  }

  compiler.__collectErrors = () => {
    const compilation = {errors: [] as Error[]}
    for (const cb of compilationTaps) cb(compilation)

    return compilation.errors
  }

  return compiler
}

const NO_BACKGROUND = {
  'chromium:manifest_version': 3,
  'firefox:manifest_version': 2,
  version: '1.0.0',
  name: 'Init Example'
}

// The chunk loading target answers the message fallback from the generated
// entry, which only this step can name.
describe('SetupBackgroundEntry generated entry', () => {
  function generated(manifest: Record<string, unknown>, browser: string) {
    const step = new SetupBackgroundEntry({
      manifestPath: writeManifest(manifest),
      browser: browser as StepBrowser
    })
    step.apply(fakeCompiler())

    return step.generated
  }

  it('names the worker it generates for Chromium', () => {
    expect(generated(NO_BACKGROUND, 'chrome')).toEqual({
      serviceWorkerEntry: 'background/service_worker'
    })
  })

  it('names the page script it generates for Firefox and for MV2', () => {
    expect(generated(NO_BACKGROUND, 'firefox')).toEqual({
      pageEntry: 'background/script'
    })

    expect(generated({manifest_version: 2}, 'chrome')).toEqual({
      pageEntry: 'background/script'
    })
  })

  it('names nothing when the author declared the background', () => {
    expect(
      generated(
        {manifest_version: 3, background: {service_worker: 'sw.js'}},
        'chrome'
      )
    ).toBeUndefined()

    expect(
      generated(
        {manifest_version: 2, background: {scripts: ['bg.js']}},
        'firefox'
      )
    ).toBeUndefined()

    expect(
      generated({manifest_version: 2, background: {page: 'bg.html'}}, 'firefox')
    ).toBeUndefined()
  })
})

describe('SetupBackgroundEntry default entry registration', () => {
  it('registers background/service_worker for Safari when no background is declared', () => {
    const manifestPath = writeManifest(NO_BACKGROUND)
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'safari'}).apply(compiler)

    expect(compiler.options.entry).toHaveProperty('background/service_worker')
  })

  it('registers background/service_worker for Chrome when no background is declared', () => {
    const manifestPath = writeManifest(NO_BACKGROUND)
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    expect(compiler.options.entry).toHaveProperty('background/service_worker')
  })

  it('registers background/script (MV2 scripts) for Firefox when no background is declared', () => {
    const manifestPath = writeManifest(NO_BACKGROUND)
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'firefox'}).apply(compiler)

    expect(compiler.options.entry).toHaveProperty('background/script')
    expect(compiler.options.entry).not.toHaveProperty(
      'background/service_worker'
    )
  })

  for (const browser of ['waterfox', 'librewolf', 'zen', 'floorp']) {
    it(`registers background/script for the gecko fork ${browser}`, () => {
      const manifestPath = writeManifest(NO_BACKGROUND)
      const compiler = fakeCompiler()

      new SetupBackgroundEntry({
        manifestPath,
        browser: browser as StepBrowser
      }).apply(compiler)

      expect(compiler.options.entry).toHaveProperty('background/script')
      expect(compiler.options.entry).not.toHaveProperty(
        'background/service_worker'
      )
    })
  }
})

describe('SetupBackgroundEntry with a declared background', () => {
  function writeBackgroundFile(manifestPath: string, name: string) {
    const file = path.join(path.dirname(manifestPath), name)
    fs.writeFileSync(file, '// background', 'utf8')

    return file
  }

  it('leaves the entry alone for Firefox when background.scripts exists on disk', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'Declared',
      version: '1.0.0',
      background: {scripts: ['bg.js']}
    })
    writeBackgroundFile(manifestPath, 'bg.js')
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'firefox'}).apply(compiler)

    expect(compiler.options.entry).toEqual({})
    expect(compiler.__collectErrors()).toHaveLength(0)
  })

  it('leaves a missing Firefox script to the scripts feature', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'Declared',
      version: '1.0.0',
      background: {scripts: ['missing.js']}
    })
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'firefox'}).apply(compiler)

    expect(compiler.__collectErrors()).toHaveLength(0)
    expect(compiler.options.entry).toEqual({})
  })

  it('registers background/script for a Chrome MV2 manifest with no background', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'Declared',
      version: '1.0.0'
    })
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    expect(compiler.options.entry).toHaveProperty('background/script')
  })

  it('accepts a Chrome MV2 manifest with an existing background script', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'Declared',
      version: '1.0.0',
      background: {scripts: ['bg.js']}
    })
    writeBackgroundFile(manifestPath, 'bg.js')
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    expect(compiler.options.entry).toEqual({})
    expect(compiler.__collectErrors()).toHaveLength(0)
  })

  it('leaves a missing Chrome MV2 script to the scripts feature', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'Declared',
      version: '1.0.0',
      background: {scripts: ['missing.js']}
    })
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    expect(compiler.__collectErrors()).toHaveLength(0)
  })

  it('registers the declared MV3 service_worker as the entry when it exists', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'Declared',
      version: '1.0.0',
      background: {service_worker: 'sw.js'}
    })
    const swPath = writeBackgroundFile(manifestPath, 'sw.js')
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    expect(compiler.options.entry['background/service_worker']).toEqual({
      import: [swPath]
    })

    expect(compiler.__collectErrors()).toHaveLength(0)
  })

  it('adds no entry and no report when the MV3 service_worker is missing', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'Declared',
      version: '1.0.0',
      background: {service_worker: 'missing.js'}
    })
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    expect(compiler.__collectErrors()).toHaveLength(0)
    expect(compiler.options.entry).not.toHaveProperty(
      'background/service_worker'
    )
  })

  it('keeps a pre-existing background/service_worker entry untouched', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'Declared',
      version: '1.0.0',
      background: {service_worker: 'sw.js'}
    })
    writeBackgroundFile(manifestPath, 'sw.js')
    const existing = {import: ['already-registered.js']}
    const compiler = fakeCompiler({'background/service_worker': existing})

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    expect(compiler.options.entry['background/service_worker']).toBe(existing)
  })
})

// An MV2 background page IS the background context: the built manifest keeps
// naming background/index.html, so a default script entry lands nowhere.
describe('SetupBackgroundEntry with a declared MV2 background page', () => {
  for (const browser of ['chrome', 'firefox', 'edge'] as const) {
    it(`registers no orphan script entry on ${browser}`, () => {
      const manifestPath = writeManifest({
        manifest_version: 2,
        name: 'Background page',
        version: '1.0.0',
        background: {page: 'background.html'}
      })
      const compiler = fakeCompiler()

      new SetupBackgroundEntry({manifestPath, browser}).apply(compiler)

      expect(compiler.options.entry).toEqual({})
      expect(compiler.__collectErrors()).toHaveLength(0)
    })
  }

  it('still registers the script entry when the page sits next to scripts', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'Background page',
      version: '1.0.0',
      background: {page: 'background.html', scripts: ['missing.js']}
    })
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    expect(compiler.options.entry).toEqual({})
    expect(compiler.__collectErrors()).toHaveLength(0)
  })
})

const makeTempFolder = trackTempFolders()

// A static theme has no background, and the step leaves its dist a theme.
describe('SetupBackgroundEntry on a static theme', () => {
  it('adds no entry and no error tap', () => {
    const root = writeProject(makeTempFolder('extjs-bg-theme-'), {
      'manifest.json': {
        manifest_version: 3,
        name: 'Theme',
        version: '1.0.0',
        theme: {colors: {frame: '#000000'}}
      }
    })
    const compiler = idleCompiler(root, 'development')
    const taps = tapsAddedBy(compiler, () =>
      new SetupBackgroundEntry({
        manifestPath: path.join(root, 'manifest.json'),
        browser: 'chrome'
      }).apply(compiler)
    )

    expect(taps).toEqual({})
    expect(compiler.options.entry).toEqual({})
  })
})

// A missing background script is reported once, by the scripts feature, in
// every mode. The reload pipeline adds no second report of its own.
describe('a missing background script', () => {
  function project(manifest: object, files: string[]) {
    const root = writeProject(makeTempFolder('extjs-bg-required-'), {
      'manifest.json': {name: 'Required', version: '1.0.0', ...manifest},
      ...Object.fromEntries(files.map((file) => [file, '']))
    })

    return {root, manifestPath: path.join(root, 'manifest.json')}
  }

  async function errorsOf(
    mode: 'development' | 'production',
    browser: BrowserType,
    {root, manifestPath}: {root: string; manifestPath: string}
  ) {
    const options = {
      manifestPath,
      browser,
      devSession: mode === 'development'
    }
    const {errors} = await compileIssues(root, mode, {}, [
      new WebExtensionPlugin(options),
      new ReloadPlugin(options),
      new SetupChunkLoadingTarget(options)
    ])

    return errors.map((error) => diagnosticCode(error))
  }

  const missingWorker = {
    manifest_version: 3,
    background: {service_worker: 'missing.js'}
  }

  it('is reported once by a dev session, as a missing entry', async () => {
    expect(
      await errorsOf('development', 'chrome', project(missingWorker, []))
    ).toEqual(['E_ENTRY_NOT_FOUND'])
  })

  it('is reported the same way by a production build', async () => {
    expect(
      await errorsOf('production', 'chrome', project(missingWorker, []))
    ).toEqual(['E_ENTRY_NOT_FOUND'])
  })

  it('is reported for a missing second background script too', async () => {
    const manifest = {
      manifest_version: 2,
      background: {scripts: ['present.js', 'missing.js']}
    }

    expect(
      await errorsOf(
        'development',
        'firefox',
        project(manifest, ['present.js'])
      )
    ).toEqual(['E_ENTRY_NOT_FOUND'])
  })
})
