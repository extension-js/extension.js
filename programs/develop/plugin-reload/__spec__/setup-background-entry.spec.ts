import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  compileIssues,
  idleCompiler,
  tapsAddedBy,
  writeProject
} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {diagnosticCode} from '../../lib/diagnostic-code'
import {SetupChunkLoadingTarget} from '../../plugin-web-extension/feature-chunk-loading'
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

function fakeCompiler(entry: Record<string, unknown> = {}) {
  const compilationTaps: Array<(compilation: any) => void> = []
  const compiler = {
    options: {entry},
    hooks: {
      thisCompilation: {
        tap: (_name: string, cb: (compilation: any) => void) => {
          compilationTaps.push(cb)
        }
      }
    }
  } as any

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
      browser: browser as any
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

      new SetupBackgroundEntry({manifestPath, browser: browser as any}).apply(
        compiler
      )

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

  it('reports an error for Firefox when the declared script is missing', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'Declared',
      version: '1.0.0',
      background: {scripts: ['missing.js']}
    })
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'firefox'}).apply(compiler)

    const errors = compiler.__collectErrors()
    expect(errors).toHaveLength(1)
    expect(String(errors[0].message)).toContain('background.scripts')
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

  it('reports an error for Chrome MV2 when the declared script is missing', () => {
    const manifestPath = writeManifest({
      manifest_version: 2,
      name: 'Declared',
      version: '1.0.0',
      background: {scripts: ['missing.js']}
    })
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    const errors = compiler.__collectErrors()
    expect(errors).toHaveLength(1)
    expect(String(errors[0].message)).toContain('background.scripts')
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

  it('reports an error and adds no entry when the MV3 service_worker is missing', () => {
    const manifestPath = writeManifest({
      manifest_version: 3,
      name: 'Declared',
      version: '1.0.0',
      background: {service_worker: 'missing.js'}
    })
    const compiler = fakeCompiler()

    new SetupBackgroundEntry({manifestPath, browser: 'chrome'}).apply(compiler)

    const errors = compiler.__collectErrors()
    expect(errors).toHaveLength(1)
    expect(String(errors[0].message)).toContain('background.service_worker')
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
    expect(compiler.__collectErrors()).toHaveLength(1)
  })
})

const makeTempFolder = trackTempFolders()

// A static theme has no background, and the step leaves its dist a theme.
describe('SetupBackgroundEntry on a static theme', () => {
  // Pins today's behavior. Ledger 1385 D10.
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

// The missing background check runs only inside the dev reload pipeline, so
// it is read here through the same two plugins rspack-config applies.
describe('the background required error', () => {
  function project(manifest: object, files: string[]) {
    const root = writeProject(makeTempFolder('extjs-bg-required-'), {
      'manifest.json': {name: 'Required', version: '1.0.0', ...manifest},
      'content.js': '',
      ...Object.fromEntries(files.map((file) => [file, '']))
    })

    return {root, manifestPath: path.join(root, 'manifest.json')}
  }

  async function errorsOf(
    mode: 'development' | 'production',
    browser: string,
    {root, manifestPath}: {root: string; manifestPath: string}
  ) {
    const {errors} = await compileIssues(
      root,
      mode,
      {'content_scripts/content-0': 'content.js'},
      [
        new ReloadPlugin({manifestPath, browser} as ConstructorParameters<
          typeof ReloadPlugin
        >[0]),
        new SetupChunkLoadingTarget({
          manifestPath,
          browser
        } as ConstructorParameters<typeof SetupChunkLoadingTarget>[0])
      ]
    )

    return errors.map((error) => ({...error, code: diagnosticCode(error)}))
  }

  const missingWorker = {
    manifest_version: 3,
    background: {service_worker: 'missing.js'}
  }

  // Pins today's behavior. Ledger 1385 D5.
  it('is raised by a dev session for a missing service worker', async () => {
    expect(
      await errorsOf('development', 'chrome', project(missingWorker, []))
    ).toEqual([
      {
        name: 'BackgroundRequired',
        message:
          'Check the background.service_worker field in your manifest.json file.',
        code: 'E_BACKGROUND_REQUIRED'
      }
    ])
  })

  // Pins today's behavior. Ledger 1385 D5.
  it('is not raised by a production build of the same manifest', async () => {
    expect(
      await errorsOf('production', 'chrome', project(missingWorker, []))
    ).toEqual([])
  })

  // Pins today's behavior. Ledger 1385 D5.
  it('checks only the first background script', async () => {
    const manifest = (scripts: string[]) => ({
      manifest_version: 2,
      background: {scripts}
    })

    expect(
      await errorsOf(
        'development',
        'firefox',
        project(manifest(['present.js', 'missing.js']), ['present.js'])
      )
    ).toEqual([])

    expect(
      await errorsOf(
        'development',
        'firefox',
        project(manifest(['missing.js', 'present.js']), ['present.js'])
      )
    ).toEqual([
      {
        name: 'BackgroundRequired',
        message:
          'Check the background.scripts field in your manifest.json file.',
        code: 'E_BACKGROUND_REQUIRED'
      }
    ])
  })
})
