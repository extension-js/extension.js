import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

// A bare manifest one directory under an unrelated package.json sits exactly
// where src/manifest.json sits in the documented layout. Adopting the stranger
// put the build in its dist and made its scripts/ folder a build input, which
// failed on the node: imports those tooling scripts reach.
const STRANGER_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-declined-stranger-')
)
const OWNED_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-declined-owned-')
)
const DECLARED_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-declined-declared-')
)

const MANIFEST = {
  manifest_version: 3,
  name: 'Declined project root spec',
  version: '1.0.0'
}

function write(target: string, body: string) {
  fs.mkdirSync(path.dirname(target), {recursive: true})
  fs.writeFileSync(target, body)
}

function writePackageJson(root: string, extra: Record<string, unknown> = {}) {
  write(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'host', version: '0.0.0', ...extra})
  )
}

// Two files on purpose: a direct node: import in a scripts/ entry is filtered
// out, so the real shape reaches the builtin through a sibling.
function writeToolingScripts(root: string) {
  write(
    path.join(root, 'scripts', 'helper.js'),
    "export {default as proc} from 'node:process'\n"
  )

  write(
    path.join(root, 'scripts', 'tooling.js'),
    "import {proc} from './helper.js'\nconsole.log(proc.cwd())\n"
  )
}

function writeStrangerFixture() {
  writePackageJson(STRANGER_ROOT)
  writeToolingScripts(STRANGER_ROOT)
  write(
    path.join(STRANGER_ROOT, 'inner', 'manifest.json'),
    JSON.stringify(MANIFEST)
  )
}

function writeOwnedFixture() {
  writePackageJson(OWNED_ROOT)
  writeToolingScripts(OWNED_ROOT)
  write(path.join(OWNED_ROOT, 'src', 'manifest.json'), JSON.stringify(MANIFEST))
}

function writeDeclaredFixture() {
  writePackageJson(DECLARED_ROOT, {devDependencies: {extension: '^4.1.30'}})
  write(
    path.join(DECLARED_ROOT, 'inner', 'manifest.json'),
    JSON.stringify(MANIFEST)
  )
}

async function buildFixture(projectPath: string) {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')

  try {
    return await extensionBuild(projectPath, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } finally {
    if (previousAuthorMode === undefined) {
      Reflect.deleteProperty(process.env, 'EXTENSION_AUTHOR_MODE')
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }

    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

describe('a project root that does not own the manifest', () => {
  beforeAll(() => {
    writeStrangerFixture()
    writeOwnedFixture()
    writeDeclaredFixture()
  })

  afterAll(() => {
    for (const root of [STRANGER_ROOT, OWNED_ROOT, DECLARED_ROOT]) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('builds into the manifest folder and leaves the stranger alone', async () => {
    await buildFixture(path.join(STRANGER_ROOT, 'inner'))

    expect(
      fs.existsSync(path.join(STRANGER_ROOT, 'inner', 'dist', 'chrome'))
    ).toBe(true)

    expect(fs.existsSync(path.join(STRANGER_ROOT, 'dist'))).toBe(false)
  })

  it('does not compile the stranger scripts folder', async () => {
    const emitted = path.join(
      STRANGER_ROOT,
      'inner',
      'dist',
      'chrome',
      'scripts'
    )

    expect(fs.existsSync(emitted)).toBe(false)
  })

  it('keeps the documented src layout on the package root', async () => {
    await buildFixture(OWNED_ROOT)

    expect(fs.existsSync(path.join(OWNED_ROOT, 'dist', 'chrome'))).toBe(true)
    expect(fs.existsSync(path.join(OWNED_ROOT, 'src', 'dist'))).toBe(false)
  })

  it('adopts a root that depends on Extension.js', async () => {
    await buildFixture(path.join(DECLARED_ROOT, 'inner'))

    expect(fs.existsSync(path.join(DECLARED_ROOT, 'dist', 'chrome'))).toBe(true)

    expect(fs.existsSync(path.join(DECLARED_ROOT, 'inner', 'dist'))).toBe(false)
  })
})
