import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const DYNAMIC_GROUP = {
  resources: ['pages/engine.html', 'images/logo.png'],
  matches: ['*://www.youtube.com/*'],
  use_dynamic_url: true
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-war-dynamic-'))
  roots.push(root)

  const write = (file: string, content: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true})
    fs.writeFileSync(path.join(root, file), content)
  }

  write(
    'package.json',
    JSON.stringify({private: true, name: 'war-dynamic', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'war-dynamic',
      version: '1.0.0',
      content_scripts: [
        {matches: ['*://www.youtube.com/*'], js: ['content/youtube.js']}
      ],
      web_accessible_resources: [DYNAMIC_GROUP]
    })
  )

  // The content script names both files, so the build's payload scan finds them
  write(
    'content/youtube.js',
    "const page = chrome.runtime.getURL('pages/engine.html')\nconst logo = chrome.runtime.getURL('images/logo.png')\nconsole.log(page, logo)\n"
  )

  write(
    'pages/engine.html',
    '<!doctype html><html><body><script src="./engine.js"></script></body></html>\n'
  )

  write('pages/engine.js', "console.log('engine')\n")
  write(
    'public/images/logo.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    )
  )

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('a use_dynamic_url group the author declares', () => {
  it('stays the only group listing its pages/ entry and public/ file', async () => {
    const root = project()
    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'manifest.json'),
        'utf-8'
      )
    )
    const groups: Array<{resources: string[]}> =
      manifest.web_accessible_resources
    const listing = (resource: string) =>
      groups.filter((group) => group.resources.includes(resource))

    expect(listing('pages/engine.html')).toEqual([
      expect.objectContaining({use_dynamic_url: true})
    ])

    expect(listing('images/logo.png')).toEqual([
      expect.objectContaining({use_dynamic_url: true})
    ])
  })
})
