import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'

// url() requests the stylesheet check leaves to the bundler: a bare name with
// no extension, a scoped package path, a name only public/ holds.
const UNRESOLVED = ['noext', '@scope/missing/x.png', 'in-public.png']
const roots: string[] = []
const savedStrict = process.env.EXTENSION_STRICT_REFS

afterEach(() => {
  if (savedStrict === undefined) delete process.env.EXTENSION_STRICT_REFS
  else process.env.EXTENSION_STRICT_REFS = savedStrict
})

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, relPath: string, contents: string) {
  const abs = path.join(root, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-unresolved-'))
  roots.push(root)

  write(
    root,
    'package.json',
    JSON.stringify({private: true, name: 'css-unresolved', version: '0.0.0'})
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'css-unresolved',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'}
    })
  )

  write(
    root,
    'popup/index.html',
    '<!doctype html><html><head><link rel="stylesheet" href="./popup.css"></head><body>x</body></html>\n'
  )

  write(
    root,
    'popup/popup.css',
    UNRESOLVED.map((ref, i) => `.r${i} { background: url(${ref}) }`).join(
      '\n'
    ) + '\n'
  )

  write(root, 'public/in-public.png', 'x')

  return root
}

async function build(root: string) {
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await buildProject(root, {mode: 'production', exitOnError: false})
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('a url() the bundler resolves to nothing', () => {
  it('is a dead reference warning, one per request', async () => {
    delete process.env.EXTENSION_STRICT_REFS
    const summary = await build(project())
    const lines = (summary.warnings || []).map((line) => line.split('\n')[0])

    expect(summary.errors_count).toBe(0)

    for (const ref of UNRESOLVED) {
      expect(
        lines.filter((line) => line.includes(`url(${ref}) reference`))
      ).toHaveLength(1)
    }
  }, 120_000)

  it('fails the build under strict refs, with the dead reference code', async () => {
    process.env.EXTENSION_STRICT_REFS = 'true'
    const error: any = await build(project()).catch((caught) => caught)

    expect(error?.code).toBe('E_COMPILE')

    const dead = (error?.diagnostics || []).filter(
      (detail: {code?: string}) => detail.code === 'E_CSS_DEAD_REF'
    )

    for (const ref of UNRESOLVED) {
      expect(
        dead.filter((detail: {message: string}) =>
          detail.message.includes(`url(${ref})`)
        )
      ).toHaveLength(1)
    }

    // The reader set the variable the hint would name.
    expect(
      dead.some((detail: {message: string}) =>
        detail.message.includes('EXTENSION_STRICT_REFS')
      )
    ).toBe(false)
  }, 120_000)
})
