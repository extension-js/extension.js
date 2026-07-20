import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
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
  // Drives the captured thisCompilation taps against a bare compilation and
  // returns the errors they reported.
  compiler.__collectErrors = () => {
    const compilation = {errors: [] as Error[]}
    for (const cb of compilationTaps) cb(compilation)
    return compilation.errors
  }
  return compiler
}

// A manifest shaped like the `init` template: no background declared, and the
// manifest_version is only present under chromium:/firefox: prefixes.
const NO_BACKGROUND = {
  'chromium:manifest_version': 3,
  'firefox:manifest_version': 2,
  version: '1.0.0',
  name: 'Init Example'
}

describe('SetupBackgroundEntry default entry registration', () => {
  it('registers background/service_worker for Safari when no background is declared', () => {
    // Regression: Safari is neither chromium- nor gecko-classified, so the
    // prefixed manifest_version keys do not resolve (manifestVersion is
    // undefined). patch-background still injects background.service_worker, so
    // the matching entry must be created or the persist-manifest gate fails the
    // first build with "files were not emitted to disk".
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

  // Gecko forks must be treated like Firefox (MV2 background.scripts), not fall
  // through to the chromium service_worker default.
  for (const browser of ['waterfox', 'librewolf']) {
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
