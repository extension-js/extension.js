import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

// The dev server serves and restarts a session. Reload decisions belong to
// plugin-reload and browsers to plugin-browsers, reached through index.ts.
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

const files = sourceFiles(FOLDER).map((file) => ({
  file: path.relative(FOLDER, file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8')
}))

const importsOf = (text: string) =>
  [
    ...text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)
  ].map((match) => ({
    names: match[1]
      .split(',')
      .map((name) => name.replace(/^\s*type\s+/, '').trim())
      .filter(Boolean),
    from: match[2]
  }))

const reaching = (folder: string) =>
  files
    .filter(({text}) =>
      importsOf(text).some(({from}) => from.includes(`/${folder}`))
    )
    .map(({file}) => file)
    .sort()

describe('what the dev server reaches in the other plugins', () => {
  it('reads its own source files', () => {
    expect(files.map(({file}) => file)).toContain('index.ts')
  })

  it('reaches plugin-reload from index.ts alone, for these names', () => {
    expect(reaching('plugin-reload')).toEqual(['index.ts'])

    const names = files
      .flatMap(({text}) => importsOf(text))
      .filter(({from}) => from.includes('/plugin-reload'))
      .flatMap(({names}) => names)
      .sort()

    expect(names).toEqual([
      'attachHtmlRefresh',
      'dispatchRestartReload',
      'fullReloadsDeliveredTo',
      'readDevBuild',
      'reloadEachBuild'
    ])
  })

  it('reaches plugin-browsers from index.ts alone', () => {
    expect(reaching('plugin-browsers')).toEqual(['index.ts'])
  })

  it('reaches plugin-ready-contract from the two files that drive its writer', () => {
    expect(reaching('plugin-ready-contract')).toEqual([
      'index.ts',
      'session-start-prune.ts'
    ])
  })

  it('reaches plugin-web-extension nowhere', () => {
    expect(reaching('plugin-web-extension')).toEqual([])
  })
})

describe('reload decisions the dev server still makes', () => {
  it('sends a reload frame from the broker alone', () => {
    const senders = files
      .filter(({text}) => /\bbroadcastReload\s*\(/.test(text))
      .map(({file}) => file)

    expect(senders).toEqual(['control-bridge/broker.ts'])
  })

  it('holds no page markup reload, which plugin-reload attaches', () => {
    expect(files.map(({file}) => file)).not.toContain('html-refresh.ts')
  })

  it('classifies no change itself', () => {
    expect(
      files
        .filter(({text}) =>
          /classifyReload|createChangedSourcesTracker|createReloadSession/.test(
            text
          )
        )
        .map(({file}) => file)
    ).toEqual([])
  })
})

// A plugin asks for a restart, a restart in progress or a line of output
// through lib. The dev server answers there, so no plugin imports it.
describe('what the plugins reach in the dev server', () => {
  const DEVELOP = path.resolve(FOLDER, '..')
  const pluginFiles = fs
    .readdirSync(DEVELOP, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('plugin-'))
    .flatMap((entry) => sourceFiles(path.join(DEVELOP, entry.name)))
    .map((file) => ({
      file: path.relative(DEVELOP, file).split(path.sep).join('/'),
      text: fs.readFileSync(file, 'utf8')
    }))

  const reached = (text: string) =>
    [...text.matchAll(/from\s+'((?:\.\.\/)+dev-server\/[^']+)'/g)].map(
      (match) => match[1].replace(/^(?:\.\.\/)+dev-server\//, '')
    )

  it('reads the plugin folders', () => {
    expect(pluginFiles.length).toBeGreaterThan(100)
  })

  it('reaches the control bridge from plugin-reload and nothing else', () => {
    const rows = pluginFiles
      .flatMap(({file, text}) =>
        reached(text).map((module) => `${file.split('/')[0]} ${module}`)
      )
      .filter((row, index, all) => all.indexOf(row) === index)
      .sort()

    expect(rows).toEqual([
      'plugin-reload control-bridge/contracts',
      'plugin-reload control-bridge/producer-runtime'
    ])
  })

  it('asks for a restart through lib alone', () => {
    const askers = pluginFiles
      .filter(({text}) =>
        /session-restart'|main-world-restart'|lifecycle-stream'/.test(text)
      )
      .map(({file}) => file)

    expect(askers).toEqual([])

    expect(
      pluginFiles
        .filter(({text}) => text.includes("lib/session-restart-signal'"))
        .map(({file}) => file)
        .sort()
    ).toEqual([
      'plugin-compilation/watch-env-files.ts',
      'plugin-special-folders/index.ts',
      'plugin-special-folders/warn-upon-folder-changes.ts',
      'plugin-web-extension/feature-html/steps/throw-if-recompile-is-needed.ts',
      'plugin-web-extension/feature-manifest/steps/persist-manifest.ts',
      'plugin-web-extension/feature-scripts/steps/warn-main-world-registration-changed.ts',
      'plugin-web-extension/shared/manifest-fields-change-detector.ts'
    ])
  })
})
