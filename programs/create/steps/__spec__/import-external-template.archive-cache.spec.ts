import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {strToU8, zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  DEFAULT_TEMPLATES_REF,
  importExternalTemplate,
  type TemplateFetch,
  templateArchiveCacheDir
} from '../import-external-template'

const quiet = {log: () => {}, error: () => {}}
let workDir: string
let cacheDir: string

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-archive-cache-'))
  cacheDir = path.join(workDir, 'cache')
  process.env.EXTENSION_ENV = 'test'
  delete process.env.EXTENSION_CREATE_TEMPLATE_REF
  delete process.env.EXTENSION_CREATE_TEMPLATE_URL
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(workDir, {recursive: true, force: true})
})

function catalogZip(marker: string): Buffer {
  return Buffer.from(
    zipSync({
      [`templates-${DEFAULT_TEMPLATES_REF}/examples/react/package.json`]:
        strToU8(JSON.stringify({name: 'react', marker})),
      [`templates-${DEFAULT_TEMPLATES_REF}/examples/vue/package.json`]:
        strToU8('{"name":"vue"}')
    })
  )
}

// Counts every download and answers with the archive it is handed.
function serving(body: Buffer) {
  return vi.fn<TemplateFetch>(async () => ({
    data: body,
    headers: {'content-type': 'application/zip'}
  }))
}

async function create(name: string, fetch: TemplateFetch) {
  const projectPath = path.join(workDir, name)

  await importExternalTemplate(projectPath, name, 'react', quiet, {
    ownsProjectDir: true,
    fetch,
    archiveCacheDir: cacheDir
  })

  return JSON.parse(
    fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8')
  ) as {name: string; marker: string}
}

describe('the pinned catalog archive is downloaded once per machine', () => {
  it('scaffolds a second project from the pin with no download', async () => {
    const fetch = serving(catalogZip('first'))

    expect((await create('one', fetch)).marker).toBe('first')
    expect((await create('two', fetch)).marker).toBe('first')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(cacheDir)).toEqual([`${DEFAULT_TEMPLATES_REF}.zip`])
  })

  it('downloads again over a damaged copy and keeps the good one', async () => {
    fs.mkdirSync(cacheDir, {recursive: true})
    // A ZIP signature with nothing valid after it.
    fs.writeFileSync(
      path.join(cacheDir, `${DEFAULT_TEMPLATES_REF}.zip`),
      Buffer.from('PK\u0003\u0004 truncated')
    )

    const fetch = serving(catalogZip('fresh'))

    expect((await create('one', fetch)).marker).toBe('fresh')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((await create('two', fetch)).marker).toBe('fresh')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never keeps a branch or tag archive, which can move', async () => {
    vi.stubEnv('EXTENSION_CREATE_TEMPLATE_REF', 'main')
    const fetch = serving(catalogZip('branch'))

    await create('one', fetch)
    await create('two', fetch)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fs.existsSync(cacheDir)).toBe(false)
  })

  it('keeps no more than three pins', async () => {
    fs.mkdirSync(cacheDir, {recursive: true})

    for (const [index, sha] of ['a', 'b', 'c'].entries()) {
      const file = path.join(cacheDir, `${sha.repeat(40)}.zip`)
      fs.writeFileSync(file, catalogZip(sha))
      fs.utimesSync(file, 1000 + index, 1000 + index)
    }

    await create('one', serving(catalogZip('new')))

    expect(fs.readdirSync(cacheDir).sort()).toEqual(
      [
        `${DEFAULT_TEMPLATES_REF}.zip`,
        `${'b'.repeat(40)}.zip`,
        `${'c'.repeat(40)}.zip`
      ].sort()
    )
  })
})

describe('templateArchiveCacheDir', () => {
  it.each([
    ['linux', {HOME: '/home/me'}, '/home/me/.cache/extension.js/templates'],
    [
      'linux',
      {HOME: '/home/me', XDG_CACHE_HOME: '/xdg'},
      '/xdg/extension.js/templates'
    ],
    [
      'darwin',
      {HOME: '/Users/me'},
      '/Users/me/Library/Caches/extension.js/templates'
    ],
    [
      'win32',
      {LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local'},
      'C:\\Users\\me\\AppData\\Local\\extension.js\\templates'
    ],
    [
      'win32',
      {USERPROFILE: 'C:\\Users\\me'},
      'C:\\Users\\me\\AppData\\Local\\extension.js\\templates'
    ]
  ] as const)('%s with %j keeps archives in %s', (platform, env, expected) => {
    expect(templateArchiveCacheDir(env, platform, '/unused')).toBe(expected)
  })

  it('moves to EXTENSION_CREATE_CACHE_DIR when it is set', () => {
    expect(
      templateArchiveCacheDir(
        {
          EXTENSION_CREATE_CACHE_DIR: path.join(workDir, 'mine')
        },
        'linux',
        '/unused'
      )
    ).toBe(path.join(workDir, 'mine'))
  })
})
