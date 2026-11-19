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
