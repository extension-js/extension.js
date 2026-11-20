import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {buildPages} from './helpers/page-builds'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, relPath: string, contents: string) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-map-names-'))
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'map-names', version: '0.0.0'})
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'map-names',
      version: '1.0.0',
      background: {service_worker: 'bg.js'},
      action: {default_popup: 'popup.html'},
      content_scripts: [
        {matches: ['https://map.example/*'], js: ['content/index.js']}
      ]
    })
  )

  write(root, 'bg.js', 'console.log("bg")\n')
  write(
    root,
    'popup.html',
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>\n'
  )

  write(root, 'popup.js', 'console.log("popup")\n')
  write(root, 'content/index.js', 'console.log("content")\n')

  return root
}

function mapSources(distDir: string): string[] {
  const sources: string[] = []

  for (const entry of fs.readdirSync(distDir, {recursive: true})) {
    const file = path.join(distDir, String(entry))

    if (file.endsWith('.map')) {
      sources.push(...JSON.parse(fs.readFileSync(file, 'utf8')).sources)
    }
  }

  return sources
}

describe('dev source maps', () => {
  it('name the files of Extension.js under extension.js/, never by a path to the install', async () => {
    const root = project()
    const previous = process.env.VITEST
    process.env.VITEST = 'true'

    try {
      await buildProject(root, {mode: 'development', exitOnError: false})
    } finally {
      if (previous === undefined) delete process.env.VITEST
      else process.env.VITEST = previous
    }

    const sources = mapSources(path.join(root, 'dist', 'chrome'))

    expect(sources).toContain('webpack://map-names/./popup.js')
    expect(sources.filter((source) => source.includes('/../'))).toEqual([])
    // A development build that ships holds the author's files alone.
    expect(
      sources.filter((source) =>
        source.startsWith('webpack://map-names/extension.js/')
      )
    ).toEqual([])
  }, 120_000)

  it('name the reload client of a dev session under extension.js/ too', async () => {
    const root = project()

    await buildPages(root, 'development session')

    const sources = mapSources(
      path.join(root, 'dist', 'chrome-development-session')
    )

    expect(sources).toContain('webpack://map-names/./popup.js')
    // The dev server's own client is a dependency and is named as one.
    expect(
      sources.filter(
        (source) =>
          source.includes('/../') && !/[\\/]node_modules[\\/]/.test(source)
      )
    ).toEqual([])

    expect(
      sources.some((source) =>
        source.startsWith('webpack://map-names/extension.js/')
      )
    ).toBe(true)
  }, 120_000)
})
