import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

// The scripts feature compiles content scripts in every mode. What a dev
// session adds to replace a copy in a live page belongs to plugin-reload.
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
})
