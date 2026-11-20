import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

// plugin-browsers handles browsers only. What reloads and when is the reload
// session's answer, and restarts belong to the dev server.
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

// Every module specifier with the names it brings in, type-only or not.
function importsOf(text: string) {
  const found: Array<{from: string; names: string[]; typeOnly: boolean}> = []
  const pattern =
    /import\s+(type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)\s+from\s+'([^']+)'/g

  for (const match of text.matchAll(pattern)) {
    const names = (match[2] || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)

    found.push({from: match[3], names, typeOnly: Boolean(match[1])})
  }

  return found
}

const files = sourceFiles(FOLDER).map((file) => ({
  file: path.relative(FOLDER, file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8')
}))

describe('what plugin-browsers reaches outside its folder', () => {
  it('reads its own source files', () => {
    expect(files.map(({file}) => file)).toEqual(
      expect.arrayContaining(['index.ts', 'safari-dev-plugin.ts'])
    )
  })

  it('imports nothing from the dev server', () => {
    expect(
      files
        .filter(({text}) =>
          importsOf(text).some(({from}) => from.includes('dev-server'))
        )
        .map(({file}) => file)
    ).toEqual([])
  })

  it('reaches plugin-reload only through the reload session entry', () => {
    const allowed = new Set([
      'createReloadSession',
      'type BuildHold',
      'type ReloadBroker',
      'type ReloadInstruction',
      'type ReloadPlan',
      'type ReloadSession'
    ])
    const reached = files.flatMap(({file, text}) =>
      importsOf(text)
        .filter(({from}) => from.includes('plugin-reload'))
        .map((entry) => ({file, ...entry}))
    )

    expect(reached.map(({from}) => from)).toEqual(
      reached.map(() => '../plugin-reload')
    )

    expect(
      reached.flatMap(({names}) => names).filter((name) => !allowed.has(name))
    ).toEqual([])
  })

  it('classifies, holds and dispatches nothing itself', () => {
    const reloadWork =
      /\b(?:reloadForBuild|dispatchReload|createChangedSourcesTracker|loadedContentScriptsFor|reloadSurvivingPackage|mergeReloadInstructions|isAwaitingMainWorldRestart|noteReloadApplied)\b/

    expect(
      files.filter(({text}) => reloadWork.test(text)).map(({file}) => file)
    ).toEqual([])
  })
})
