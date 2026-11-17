import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {filterKeysForThisBrowser} from 'extension-develop/manifest'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  expectedChromiumExtensionId,
  expectedGeckoExtensionId
} from '../browsers-lib/banner'

const SOURCE_MANIFEST = path.resolve(
  __dirname,
  '../../../../extensions/extension-js-devtools/src/manifest.json'
)

// The engines scripts/build-extensions.cjs builds and extension-develop ships.
const CHROMIUM_ENGINES = ['chromium', 'chrome', 'edge'] as const
const ENGINES = [...CHROMIUM_ENGINES, 'firefox'] as const

const PINNED_CHROMIUM_ID = 'kgdaecdpfkikjncaalnmmnjjfpofkcbl'
const PINNED_GECKO_ID = 'devtools@extension.js'
const PERMISSIONS = ['management', 'storage', 'tabs']

let root: string

// Each engine's manifest as the build resolves it, written where the CLI
// reads one, so the IDs come from the same code that pins them at launch.
function engineDir(engine: (typeof ENGINES)[number]) {
  return path.join(root, engine)
}

function engineManifest(engine: (typeof ENGINES)[number]) {
  return JSON.parse(
    fs.readFileSync(path.join(engineDir(engine), 'manifest.json'), 'utf8')
  )
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-companion-manifest-'))
  const source = JSON.parse(fs.readFileSync(SOURCE_MANIFEST, 'utf8'))

  for (const engine of ENGINES) {
    fs.mkdirSync(engineDir(engine), {recursive: true})
    fs.writeFileSync(
      path.join(engineDir(engine), 'manifest.json'),
      JSON.stringify(filterKeysForThisBrowser(source, engine))
    )
  }
})

afterAll(() => {
  fs.rmSync(root, {recursive: true, force: true})
})

describe('the devtools companion manifest', () => {
  it.each(ENGINES)('asks for the documented permissions on %s', (engine) => {
    const manifest = engineManifest(engine)

    expect(
      [...(manifest.permissions || [])].sort(),
      'The companion permissions changed. Update the companion paragraph in ' +
        'docs/ASSURANCE_CASE.md, then this list.'
    ).toEqual(PERMISSIONS)

    expect(manifest.optional_permissions).toBeUndefined()
    expect(manifest.host_permissions).toBeUndefined()
    expect(manifest.optional_host_permissions).toBeUndefined()
    expect(manifest.content_scripts).toBeUndefined()
  })

  it.each(
    CHROMIUM_ENGINES
  )('pins the Chromium extension ID and the new tab page on %s', (engine) => {
    expect(expectedChromiumExtensionId(engineDir(engine))).toBe(
      PINNED_CHROMIUM_ID
    )

    expect(engineManifest(engine).chrome_url_overrides).toEqual({
      newtab: 'pages/newtab.html'
    })
  })

  it('pins the Firefox add-on ID and leaves the Firefox new tab alone', () => {
    const manifest = engineManifest('firefox')

    expect(expectedGeckoExtensionId(engineDir('firefox'))).toBe(PINNED_GECKO_ID)
    expect(manifest.key).toBeUndefined()
    expect(manifest.chrome_url_overrides).toBeUndefined()
  })
})
