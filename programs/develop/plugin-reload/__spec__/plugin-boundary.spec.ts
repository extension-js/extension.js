import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

// Chunk loading belongs to plugin-web-extension in every build. A dev
// session asks its target for the message fallback and installs nothing.
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

describe('what plugin-reload knows about chunk loading', () => {
  const files = sourceFiles(FOLDER).map((file) => ({
    file: path.relative(FOLDER, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8')
  }))

  it('reads its own source files', () => {
    expect(files.map(({file}) => file)).toContain(
      'steps/setup-reload-strategy/index.ts'
    )
  })

  it('imports nothing from the chunk loading feature', () => {
    expect(
      files
        .filter(({text}) => text.includes('feature-chunk-loading'))
        .map(({file}) => file)
    ).toEqual([])
  })

  it('installs no chunk loading target or runtime module', () => {
    const chunkLoading =
      /\bChunkLoadingTarget\b|\bChunkLoaderRuntime\b|runtimeRequirementInTree|RuntimeGlobals\.(?:publicPath|baseURI|loadScript)/

    expect(
      files.filter(({text}) => chunkLoading.test(text)).map(({file}) => file)
    ).toEqual([])
  })

  it('reaches the chunk loading target only through its extension point', () => {
    const extensionPoint =
      /["'][^"']*shared\/chunk-loading-target-extensions["']/

    expect(
      files.filter(({text}) => extensionPoint.test(text)).map(({file}) => file)
    ).toEqual(['steps/setup-reload-strategy/index.ts'])
  })
})

// plugin-reload runs reload end to end. From the dev server it reads only the
// bridge it rides, and it never reaches a browser plugin or a restart.
describe('what plugin-reload reaches in the dev server and the browsers', () => {
  const files = sourceFiles(FOLDER).map((file) => ({
    file: path.relative(FOLDER, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8')
  }))
  const specifiers = (text: string) =>
    [...text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])

  it('imports nothing from plugin-browsers', () => {
    expect(
      files
        .filter(({text}) =>
          specifiers(text).some((from) => from.includes('plugin-browsers'))
        )
        .map(({file}) => file)
    ).toEqual([])
  })

  it('reads the control bridge and nothing else of the dev server', () => {
    const allowed = new Set([
      'control-bridge/contracts',
      'control-bridge/producer-runtime'
    ])
    const reached = files.flatMap(({text}) =>
      specifiers(text)
        .filter((from) => from.includes('/dev-server/'))
        .map((from) => from.split('/dev-server/')[1])
    )

    expect(reached.length).toBeGreaterThan(0)
    expect(reached.filter((from) => !allowed.has(from))).toEqual([])
  })

  // Every step that prepends to the background, the reload runtime and the
  // MAIN world wrappers alike, must find the same bundle.
  it('names the compiled background bundle in one module', () => {
    const pattern = /=\s*\/\^background\\\//
    const root = path.resolve(FOLDER, '..')
    const naming = ['plugin-reload', 'plugin-web-extension']
      .flatMap((folder) => sourceFiles(path.join(root, folder)))
      .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file).split(path.sep).join('/'))

    expect(naming).toEqual(['plugin-web-extension/shared/background-asset.ts'])
  })

  it('takes the hold of a pending restart from its caller', () => {
    expect(
      files
        .filter(({text}) =>
          /session-restart|main-world-restart|isAwaitingMainWorldRestart/.test(
            text
          )
        )
        .map(({file}) => file)
    ).toEqual([])
  })
})

// The pages belong to the HTML feature. Reload is told about them through
// one extension point and reads no file of that feature.
// Every file of another plugin this folder reads. A new row is a decision,
// since each one is something reload knows about a neighbor.
describe('what plugin-reload reaches in the other plugins', () => {
  const reached = [
    ...new Set(
      sourceFiles(FOLDER).flatMap((file) =>
        [...fs.readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)]
          .map((match) => match[1])
          .filter((from) => /\/(?:plugin-[a-z-]+|dev-server)\//.test(from))
          .map((from) => from.replace(/^(?:\.\.\/)+/, ''))
      )
    )
  ].sort()

  it('reads these files and no other', () => {
    expect(reached).toEqual([
      'dev-server/control-bridge/contracts',
      'dev-server/control-bridge/producer-runtime',
      'plugin-web-extension/feature-scripts/contracts',
      'plugin-web-extension/shared/background-asset',
      'plugin-web-extension/shared/chunk-loading-target-extensions',
      'plugin-web-extension/shared/content-script-wrapper-extensions',
      'plugin-web-extension/shared/html-page-extensions',
      'plugin-web-extension/shared/initial-files'
    ])
  })
})

describe('what plugin-reload reaches in the HTML feature', () => {
  const files = sourceFiles(FOLDER).map((file) => ({
    file: path.relative(FOLDER, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8')
  }))

  it('imports nothing from the HTML feature', () => {
    expect(
      files
        .filter(({text}) => /["'][^"']*feature-html[^"']*["']/.test(text))
        .map(({file}) => file)
    ).toEqual([])
  })

  it('is told the pages through their extension point, in one step', () => {
    expect(
      files
        .filter(({text}) =>
          /["'][^"']*shared\/html-page-extensions["']/.test(text)
        )
        .map(({file}) => file)
    ).toEqual(['steps/setup-page-reload.ts'])
  })
})

// A reload spec drives the session itself. One that needs a browser plugin
// to reach reload code is a spec of that plugin.
describe('what the specs of plugin-reload reach', () => {
  const specFolder = path.join(FOLDER, '__spec__')
  const specs = fs
    .readdirSync(specFolder, {recursive: true, encoding: 'utf8'})
    .filter((file) => /\.ts$/.test(file))
    .map((file) => ({
      file: file.split(path.sep).join('/'),
      text: fs.readFileSync(path.join(specFolder, file), 'utf8')
    }))

  it('reads its own spec files', () => {
    expect(specs.map(({file}) => file)).toContain('helpers/launched-session.ts')
  })

  it('imports nothing from plugin-browsers, its specs included', () => {
    expect(
      specs
        .filter(({text}) => /from\s+'[^']*plugin-browsers[^']*'/.test(text))
        .map(({file}) => file)
    ).toEqual([])
  })

  it('never builds a BrowsersPlugin or a SafariDevPlugin', () => {
    expect(
      specs
        .filter(({text}) =>
          /new (?:BrowsersPlugin|SafariDevPlugin)\(/.test(text)
        )
        .map(({file}) => file)
    ).toEqual([])
  })
})

// The dev server hands reload its broker and the restart hold, and asks for
// the one reload a restart owes. It runs no reload sequence of its own.
describe('what the dev server reaches in plugin-reload', () => {
  const devServer = path.resolve(FOLDER, '..', 'dev-server')
  const files = sourceFiles(devServer).map((file) => ({
    file: path.relative(devServer, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8')
  }))
  const reached = files.flatMap(({file, text}) =>
    [...text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)]
      .filter((match) => match[2].includes('plugin-reload'))
      .map((match) => ({file, from: match[2], names: match[1]}))
  )

  it('imports the entry from index.ts alone', () => {
    expect(reached.map(({file, from}) => `${file} ${from}`)).toEqual([
      'index.ts ../plugin-reload'
    ])
  })

  it('takes the session call, the restart reload and the build name', () => {
    const names = reached
      .flatMap(({names}) => names.split(','))
      .map((name) => name.trim())
      .filter(Boolean)
      .sort()

    expect(names).toEqual([
      'dispatchRestartReload',
      'fullReloadsDeliveredTo',
      'readDevBuild',
      'reloadEachBuild'
    ])
  })
})
