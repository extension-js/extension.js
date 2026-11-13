import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../lib/project'
import webpackConfig from '../rspack-config'

const SHAPES: Record<string, string> = {
  constant:
    "const P = 'pages/constant.html'\nconst el = document.createElement('iframe')\nel.src = chrome.runtime.getURL(P)\ndocument.body.appendChild(el)\n",
  helper:
    "function url(path) {\n  return chrome.runtime.getURL(path)\n}\nconst el = document.createElement('iframe')\nel.src = url('pages/helper.html')\ndocument.body.appendChild(el)\n",
  template:
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text
    "const el = document.createElement('iframe')\nel.src = `chrome-extension://${chrome.runtime.id}/pages/template.html`\ndocument.body.appendChild(el)\n",
  alias:
    "const browser = globalThis.browser || globalThis.chrome\nconst el = document.createElement('iframe')\nel.src = browser.runtime.getURL('pages/alias.html')\ndocument.body.appendChild(el)\n",
  payload: "chrome.runtime.sendMessage({open: 'pages/payload.html'})\n",
  commented:
    "// el.src = chrome.runtime.getURL('pages/commented.html')\nchrome.runtime.sendMessage({open: 'pages/commented.html'})\n"
}

const REQUESTED = ['alias', 'constant', 'helper', 'template']
const ONLY_NAMED = ['commented', 'payload']

let root: string

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-page-shapes-'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'page-shapes', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'pages'), {recursive: true})
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')

  for (const [name, source] of Object.entries(SHAPES)) {
    fs.writeFileSync(
      path.join(root, 'pages', `${name}.html`),
      `<!doctype html><html><body><h1>${name}</h1></body></html>\n`
    )

    fs.writeFileSync(path.join(root, `cs-${name}.js`), source)
  }

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'page-shapes',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: Object.keys(SHAPES).map((name) => ({
        matches: [`https://${name}.example/*`],
        js: [`cs-${name}.js`]
      }))
    })
  )
})

afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

async function compile(mode: 'development' | 'production') {
  const projectStructure = await getProjectStructure(root)
  const distPath = path.join(root, `dist-${mode}`, 'chrome')
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode,
    metadataCommand: mode === 'development' ? 'dev' : 'build',
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  if (mode === 'development') {
    config.plugins.push(new rspack.HotModuleReplacementPlugin())
  }

  config.stats = false

  const compiler: Compiler = rspack(config)
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close(() => {
        if (error || !result) return reject(error || new Error('no stats'))

        resolve(result)
      })
    })
  })

  const manifest = JSON.parse(
    fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf8')
  ) as {
    web_accessible_resources?: Array<{resources: string[]; matches: string[]}>
  }
  const exposure: Record<string, string[]> = {}

  for (const group of manifest.web_accessible_resources || []) {
    for (const resource of group.resources) {
      if (resource.startsWith('pages/')) exposure[resource] = group.matches
    }
  }

  const notes = stats.compilation.warnings
    .filter((warning) => warning.name === 'PageNamedNotExposedWarning')
    .map((warning) => String(warning.message).replace(/\u001b\[[0-9;]*m/g, ''))

  return {stats, exposure, notes}
}

describe('how a content script reaches an extension page', () => {
  for (const mode of ['production', 'development'] as const) {
    it(`exposes each page a ${mode} bundle builds a URL for, to that script's matches`, async () => {
      const built = await compile(mode)
      expect(built.stats.hasErrors()).toBe(false)

      expect(built.exposure).toEqual(
        Object.fromEntries(
          REQUESTED.map((name) => [
            `pages/${name}.html`,
            [`https://${name}.example/*`]
          ])
        )
      )
    })

    it(`notes once each page a ${mode} bundle only names`, async () => {
      const built = await compile(mode)

      expect(built.notes).toHaveLength(ONLY_NAMED.length)

      for (const name of ONLY_NAMED) {
        const note = built.notes.filter((text) =>
          text.includes(`pages/${name}.html`)
        )

        expect(note).toHaveLength(1)
        expect(note[0]).toMatch(/content_scripts\/content-\S*\.js names /)
        expect(note[0]).toContain('chrome.runtime.getURL')
        expect(note[0]).toContain('web_accessible_resources')
      }
    })
  }
})
