import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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
  return {
    options: {entry},
    hooks: {thisCompilation: {tap: () => {}}}
  } as any
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
    expect(compiler.options.entry).not.toHaveProperty('background/service_worker')
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
