import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

const HOSTILE = 'A "great" C:\\path <b>'

function project(options: {unquotedPlaceholder?: boolean} = {}) {
  const root = tempFolder('extjs-env-escape-')
  writeExtensionProject(root, {
    name: 'env-escape',
    manifest: {
      description: '$EXTENSION_PUBLIC_DESC',
      action: {default_popup: 'popup.html'}
    }
  })

  fs.writeFileSync(
    path.join(root, '.env'),
    `EXTENSION_PUBLIC_DESC=${HOSTILE}\nEXTENSION_PUBLIC_COUNT=abc\n`
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<html><head><title>$EXTENSION_PUBLIC_DESC</title></head><body><div id="root" title="$EXTENSION_PUBLIC_DESC">$EXTENSION_PUBLIC_DESC</div><script type="module" src="./popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(
    path.join(root, 'popup.js'),
    "document.getElementById('root').dataset.ready = 'yes'\n"
  )

  if (options.unquotedPlaceholder) {
    fs.mkdirSync(path.join(root, 'public'))
    fs.writeFileSync(
      path.join(root, 'public', 'config.json'),
      '{"count": $EXTENSION_PUBLIC_COUNT}\n'
    )
  }

  return root
}

async function build(root: string) {
  return buildProject(root, {
    mode: 'production'
  })
}

function read(root: string, file: string) {
  return fs.readFileSync(path.join(root, 'dist', 'chrome', file), 'utf8')
}

function decodeEntities(text: string) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

describe('build: env values keep their meaning in json and html assets', () => {
  it('lands a quote, a backslash and a < in the manifest and the page intact', async () => {
    const root = project()
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const manifest = JSON.parse(read(root, 'manifest.json'))
    expect(manifest.description).toBe(HOSTILE)

    const html = read(root, 'action/index.html')
    expect(html, html).not.toContain('$EXTENSION_PUBLIC_')

    const title = html.match(/<title>(.*?)<\/title>/)?.[1] || ''
    expect(decodeEntities(title)).toBe(HOSTILE)

    const div = html.match(/<div id="root" title="([^"]*)">(.*?)<\/div>/)
    expect(div, html).not.toBeNull()
    expect(decodeEntities(div?.[1] || '')).toBe(HOSTILE)
    expect(decodeEntities(div?.[2] || '')).toBe(HOSTILE)
  }, 120_000)

  it('fails with the var and the asset named when a value lands outside a JSON string', async () => {
    const root = project({unquotedPlaceholder: true})
    const lines: string[] = []
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '))
      })

    try {
      await expect(build(root)).rejects.toThrow('Build failed with errors')
    } finally {
      spy.mockRestore()
    }

    const output = lines.join('\n')
    expect(output, output).toContain('$EXTENSION_PUBLIC_COUNT')
    expect(output, output).toContain('config.json')
    expect(output, output).not.toContain('JSON at position')
    expect(output, output).not.toContain('parseJsonSafe')
  }, 120_000)
})
