import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

// The scripts feature compiles content scripts in every mode. What a dev
// session adds to replace a copy in a live page belongs to plugin-reload,
// and the builds a session restart replaces belong to the dev server.
const FOLDER = path.resolve(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return entry.name === '__spec__' ? [] : sourceFiles(full)
    }

    return /\.(?:ts|js|mjs)$/.test(entry.name) ? [full] : []
  })
}

describe('what the scripts feature knows about reloading', () => {
  const files = sourceFiles(FOLDER).map((file) => ({
    file: path.relative(FOLDER, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8')
  }))

  it('reads its own source files', () => {
    expect(files.map(({file}) => file)).toContain(
      'steps/add-content-script-wrapper/content-script-wrapper.ts'
    )
  })

  it('carries no reinject runtime', () => {
    expect(
      files.filter(({text}) => text.includes('REINJECT')).map(({file}) => file)
    ).toEqual([])
  })

  it('imports nothing from plugin-reload', () => {
    const fromReload = /(?:from|import|require\()\s*\(?["'][^"']*plugin-reload/

    expect(
      files.filter(({text}) => fromReload.test(text)).map(({file}) => file)
    ).toEqual([])
  })

  it('imports nothing from plugin-browsers', () => {
    const fromBrowsers =
      /(?:from|import|require\()\s*\(?["'][^"']*plugin-browsers/

    expect(
      files.filter(({text}) => fromBrowsers.test(text)).map(({file}) => file)
    ).toEqual([])
  })

  // Which builds a dev session restart replaces is the dev server's to keep.
  // This folder asks for the restart and reports the builds through its API.
  it('keeps no restart state of its own', () => {
    const restartState = /isAwaitingMainWorldRestart|awaitingRestart|heldBuilds/

    expect(
      files.filter(({text}) => restartState.test(text)).map(({file}) => file)
    ).toEqual([])
  })

  it('reaches the dev server only through its restart API', () => {
    const fromDevServer = /["']([^"']*dev-server\/[^"']*)["']/g
    const reached = new Set(
      files.flatMap(({text}) =>
        [...text.matchAll(fromDevServer)].map(
          ([, specifier]) => specifier.split('/').pop() as string
        )
      )
    )

    expect([...reached].sort()).toEqual(['main-world-restart'])
  })
})

// No part of plugin-web-extension asks whether a build is a reload session:
// the chunk loading target installs in every build, and a session asks for
// what it needs through the target's extension point.
describe('what plugin-web-extension knows about reload sessions', () => {
  const pluginFolder = path.resolve(FOLDER, '..')
  const files = sourceFiles(pluginFolder).map((file) => ({
    file: path.relative(pluginFolder, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8')
  }))

  it('reads the whole plugin folder', () => {
    expect(files.map(({file}) => file)).toContain(
      'feature-chunk-loading/index.ts'
    )
  })

  it('never reads whether a build is a reload session', () => {
    const sessionRead = /isReloadSession|reload-session|EXTENSION_NO_RELOAD/

    expect(
      files.filter(({text}) => sessionRead.test(text)).map(({file}) => file)
    ).toEqual([])
  })
})

// What a later copy of a content script needs, the hints about it and the
// names of the files a dev session ships beside a bundle live in
// plugin-reload, and the wrapper only answers what an extension asks.
describe('what the scripts feature leaves to plugin-reload', () => {
  const read = (folder: string) =>
    sourceFiles(folder).map((file) => ({
      file: path.relative(FOLDER, file).split(path.sep).join('/'),
      text: fs.readFileSync(file, 'utf8')
    }))
  const files = [
    ...read(FOLDER),
    ...read(path.resolve(FOLDER, '..', 'feature-web-resources'))
  ]
  const wrapper = fs.readFileSync(
    path.join(
      FOLDER,
      'steps',
      'add-content-script-wrapper',
      'content-script-wrapper.ts'
    ),
    'utf8'
  )
  const matching = (pattern: RegExp) =>
    files.filter(({text}) => pattern.test(text)).map(({file}) => file)

  it('reads the web resources feature too', () => {
    expect(files.map(({file}) => file)).toContain(
      '../feature-web-resources/web-resources-lib/generate-manifest.ts'
    )
  })

  it('says nothing of re-injecting a copy, in code, comments or copy', () => {
    expect(matching(/re-?inject/i)).toEqual([])
  })

  it('prints no hint about the copy a re-inject leaves', () => {
    expect(
      matching(/contentScriptWithoutDefaultExport|defaultExportCalledAgain/)
    ).toEqual([])

    expect(wrapper).not.toMatch(/\bhumanLine\b/)
  })

  it('keys no wrapper text on a dev session for a later copy', () => {
    expect(wrapper).not.toMatch(/!isShippedBundle\s*\|\|/)
    expect(wrapper).toMatch(/\badoptsRoots\s*\|\|\s*bundleCssHydrationEnabled/)
    expect(wrapper).toMatch(/\bloadsFiles\s*\|\|\s*hasModuleGraph/)
  })

  it('names none of the files a dev session ships beside a bundle', () => {
    expect(
      matching(
        /devContentScript(?:Stub|CssMarker|SheetProbe)AssetName|content_scripts\/dev-(?:stub|css|sheet)-\$\{/
      )
    ).toEqual([])
  })
})
