import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Stats} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  openDevWatchSession
} from '../../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../../__spec__/helpers/temp-folders'

// A page script with no file is one finding, whenever the file went away:
// before a production build, before the dev session, or while it runs.
const tempFolder = trackTempFolders()

const page =
  '<!doctype html><html><body><script type="module" src="./main.js"></script><script type="module" src="./extra.js"></script></body></html>\n'

function project(withExtra: boolean): string {
  const root = fs.realpathSync(tempFolder('extjs-page-deleted-'))

  const write = (name: string, contents: string) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), contents)
  }

  write(
    'package.json',
    JSON.stringify({private: true, name: 'page-deleted', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'page-deleted',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'}
    })
  )

  write('popup/index.html', page)
  write('popup/main.js', "console.log('main')\n")
  if (withExtra) write('popup/extra.js', "console.log('extra')\n")

  return root
}

interface Finding {
  severity: 'error' | 'warning'
  name: string
  message: string
}

const findingsOf = (stats: Stats): Finding[] => {
  const read = (severity: Finding['severity'], list: Iterable<unknown>) =>
    Array.from(list as Iterable<Error>).map((issue) => ({
      severity,
      name: issue.name,
      message: String(issue.message)
    }))

  return [
    ...read('error', stats.compilation.errors),
    ...read('warning', stats.compilation.warnings)
  ].filter((finding) => finding.name.startsWith('Html'))
}

async function productionFindings(root: string): Promise<Finding[]> {
  const {rspack} = await import('@rspack/core')
  const {getProjectStructure} = await import('../../../../lib/project')
  const {default: webpackConfig} = await import('../../../../rspack-config')
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'production',
    metadataCommand: 'build',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
  } as any)

  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  const compiler = rspack(config)

  return new Promise<Finding[]>((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(() => {})
      if (error || !stats) return reject(error)

      resolve(findingsOf(stats))
    })
  })
}

let session: DevWatchSession
let devRoot = ''

beforeAll(async () => {
  devRoot = project(true)
  session = await openDevWatchSession(devRoot)
}, 120000)

afterAll(async () => {
  await session?.close()
})

// The same finding wherever the project sits on disk.
const shape = (findings: Finding[], root: string) =>
  findings.map((finding) => ({
    ...finding,
    message: finding.message.split(root).join('<root>')
  }))

describe('a page script with no file', () => {
  it('warns the same way in production, at dev startup and mid-session', async () => {
    const productionRoot = project(false)
    const production = shape(
      await productionFindings(productionRoot),
      productionRoot
    )

    expect(production.map(({severity, name}) => [severity, name])).toEqual([
      ['warning', 'HtmlEntrypointMissing']
    ])

    expect(production[0].message).toContain(
      `NOT FOUND ${path.join('<root>', 'popup', 'extra.js')}`
    )

    const startupRoot = project(false)
    const startup = await openDevWatchSession(startupRoot)

    try {
      const seen = await startup.settle()

      expect(
        shape(findingsOf(await startup.doneAfter(seen - 1)), startupRoot)
      ).toEqual(production)
    } finally {
      await startup.close()
    }

    const seen = await session.settle()
    fs.rmSync(path.join(devRoot, 'popup', 'extra.js'))
    const rebuild = await session.doneAfter(seen, 10000)

    expect(shape(findingsOf(rebuild), devRoot)).toEqual(production)
    expect(Array.from(rebuild.compilation.errors)).toEqual([])
  }, 120000)

  it('keeps shipping the scripts of the page that still have a file', () => {
    const bundle = fs.readFileSync(
      path.join(session.distPath, 'action', 'index.js'),
      'utf8'
    )

    expect(bundle).toContain("console.log('main')")
    expect(bundle).not.toContain("console.log('extra')")
  })
})
