import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {unzipSync} from 'fflate'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-zip-twice-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'src-probe', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Src Probe',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<html><body><script src="./popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(path.join(root, 'popup.js'), 'console.log("popup")\n')

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      zip: true,
      zipSource: true,
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const bytes = fs.readFileSync(
    path.join(root, 'dist', 'src-probe-1.0.0-source.zip')
  )
  const unzipped = unzipSync(new Uint8Array(bytes))
  const entries = Object.keys(unzipped)
    .map((entry) => entry.split(path.sep).join('/'))
    .sort()
  const contents = Object.fromEntries(
    entries.map((entry) => [entry, Buffer.from(unzipped[entry]).toString()])
  )

  return {bytes, entries, contents}
}

describe('build --zip --zip-source twice on a project without a .gitignore', () => {
  it('packs only the authored sources both times, byte for byte', async () => {
    const root = project()
    const first = await build(root)
    const second = await build(root)

    const authored = ['manifest.json', 'package.json', 'popup.html', 'popup.js']
    expect(first.entries).toEqual(authored)
    expect(second.entries).toEqual(authored)

    for (const run of [first, second]) {
      expect(run.entries.some((entry) => entry.startsWith('dist/'))).toBe(false)
      expect(run.entries.some((entry) => /\.zip$/i.test(entry))).toBe(false)
      expect(
        run.entries.some((entry) =>
          entry.split('/').some((segment) => segment.startsWith('.extension-'))
        )
      ).toBe(false)
    }

    expect(second.contents).toEqual(first.contents)
    expect(second.bytes.equals(first.bytes)).toBe(true)
  }, 180_000)
})
