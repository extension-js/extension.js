import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest'
import {getEnvFileCandidates} from '../../plugin-compilation/env'
import {
  envFileCandidates,
  getPreloadedEnvKeys,
  holdPreloadedEnvOf,
  loadCommandConfig,
  loadProjectConfigDefaults
} from '../config-loader'
import {buildProject} from '../../__spec__/helpers/build-project'

// Env files reach the config in the usual layers: .env.defaults only fills
// gaps, .env is the base, .env.local overrides it, and a value the shell
// exported beats every file.
const KEYS = [
  'EXTENSION_PUBLIC_A',
  'EXTENSION_PUBLIC_B',
  'EXTENSION_PUBLIC_D',
  'EXTENSION_PUBLIC_E',
  'EXTENSION_PUBLIC_STAGE',
  'EXTENSION_PUBLIC_SHELL',
  'EXTENSION_PUBLIC_ONLY_FIRST',
  'EXTENSION_PUBLIC_BOTH'
]
const roots: string[] = []
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-env-preload-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'env-preload', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'env-preload',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content)
  }

  return root
}

const ENV_FILES = {
  '.env.defaults':
    'EXTENSION_PUBLIC_A=defaults-A\nEXTENSION_PUBLIC_D=defaults-D\nEXTENSION_PUBLIC_SHELL=defaults-SHELL\n',
  '.env': 'EXTENSION_PUBLIC_B=from-dotenv\nEXTENSION_PUBLIC_D=dotenv-D\n',
  '.env.local': 'EXTENSION_PUBLIC_E=local-E\nEXTENSION_PUBLIC_D=local-D\n'
}

// The config reports what it saw so the winners are visible from outside.
const JS_CONFIG = `module.exports = {
  commands: {
    build: {
      zip: process.env.EXTENSION_PUBLIC_B === 'from-dotenv',
      profile: [
        process.env.EXTENSION_PUBLIC_A,
        process.env.EXTENSION_PUBLIC_B,
        process.env.EXTENSION_PUBLIC_D,
        process.env.EXTENSION_PUBLIC_E,
        process.env.EXTENSION_PUBLIC_SHELL
      ].join('|')
    }
  }
}
`
const MJS_CONFIG = `export default {
  commands: {
    build: {
      profile: [
        import.meta.env.EXTENSION_PUBLIC_A,
        import.meta.env.EXTENSION_PUBLIC_B,
        import.meta.env.EXTENSION_PUBLIC_D,
        import.meta.env.EXTENSION_PUBLIC_E,
        import.meta.env.EXTENSION_PUBLIC_SHELL
      ].join('|')
    }
  }
}
`

describe('env preload layering at config time', () => {
  it('layers defaults, .env and .env.local and keeps the shell value', async () => {
    process.env.EXTENSION_PUBLIC_SHELL = 'from-shell'
    const root = project({...ENV_FILES, 'extension.config.js': JS_CONFIG})
    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
      zip?: boolean
    }
    expect(config.profile).toBe(
      'defaults-A|from-dotenv|local-D|local-E|from-shell'
    )

    expect(config.zip).toBe(true)
    expect(process.env.EXTENSION_PUBLIC_SHELL).toBe('from-shell')
  })

  it('gives the mjs config style the same winners through import.meta.env', async () => {
    process.env.EXTENSION_PUBLIC_SHELL = 'from-shell'
    const root = project({...ENV_FILES, 'extension.config.mjs': MJS_CONFIG})
    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
    }
    expect(config.profile).toBe(
      'defaults-A|from-dotenv|local-D|local-E|from-shell'
    )
  })

  it('ships the zip a config toggles from a .env value', async () => {
    const root = project({...ENV_FILES, 'extension.config.js': JS_CONFIG})
    const summary = await buildProject(root, {
      mode: 'production',
      exitOnError: false
    })
    expect(summary.errors_count).toBe(0)

    const zips = fs
      .readdirSync(path.join(root, 'dist'), {recursive: true})
      .map(String)
      .filter((file) => file.endsWith('.zip'))
    expect(zips.length).toBeGreaterThan(0)
  }, 120_000)
})

// The config reads the env files of the mode that is compiling, in the order
// the bundle picks them, so both see one value for a key.
const MODE_FILES = {
  '.env': 'EXTENSION_PUBLIC_STAGE=from-dotenv\n',
  '.env.development': 'EXTENSION_PUBLIC_STAGE=from-development\n',
  '.env.production': 'EXTENSION_PUBLIC_STAGE=from-production\n'
}
const MODE_CONFIG = `const seen = String(process.env.EXTENSION_PUBLIC_STAGE)
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'seen.txt'), seen)
module.exports = {
  perfBudgets: {seen},
  commands: {build: {profile: seen}, dev: {profile: seen}}
}
`

describe('env preload follows the running mode', () => {
  it('reads .env.production for build and leaves .env.development alone', async () => {
    const root = project({...MODE_FILES, 'extension.config.js': MODE_CONFIG})
    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
    }

    expect(config.profile).toBe('from-production')
  })

  it('reads .env.development for dev', async () => {
    const root = project({...MODE_FILES, 'extension.config.js': MODE_CONFIG})
    const config = (await loadCommandConfig(root, 'dev')) as {profile?: string}

    expect(config.profile).toBe('from-development')
  })

  it('hides a development-only file from a build', async () => {
    const root = project({
      '.env.development': MODE_FILES['.env.development'],
      'extension.config.js': MODE_CONFIG
    })
    const config = (await loadCommandConfig(root, 'build')) as {
      profile?: string
    }

    expect(config.profile).toBe('undefined')
  })

  it('lets a file named for the browser win when the caller names it', async () => {
    const root = project({
      ...MODE_FILES,
      '.env.firefox': 'EXTENSION_PUBLIC_STAGE=from-firefox\n',
      '.env.chrome.production': 'EXTENSION_PUBLIC_STAGE=from-chrome\n',
      'extension.config.js': MODE_CONFIG
    })
    const config = (await loadProjectConfigDefaults(root, {
      mode: 'production',
      browser: 'firefox'
    })) as {perfBudgets?: {seen?: string}}

    expect(config.perfBudgets?.seen).toBe('from-firefox')
  })

  // Written out, since the env plugin takes this same list and would agree
  // with any order. Exact name first, then the family, then the shared files.
  it('lists the files strongest first, browser files above the shared ones', () => {
    const forNames = (mode: string, names: string[]) => [
      ...names.flatMap((name) => [`.env.${name}.${mode}`, `.env.${name}`]),
      `.env.${mode}.local`,
      `.env.${mode}`,
      '.env.local',
      '.env'
    ]
    const chromium = ['chromium', 'chrome', 'edge', 'chromium-based']
    const gecko = ['firefox', 'gecko-based']
    const expected: Record<string, string[]> = {
      chrome: ['chrome', 'chromium', 'edge', 'chromium-based'],
      edge: ['edge', 'chromium', 'chrome', 'chromium-based'],
      'chromium-based': ['chromium-based', 'chromium', 'chrome', 'edge'],
      firefox: gecko,
      'gecko-based': ['gecko-based', 'firefox'],
      safari: ['safari', ...chromium],
      'acme-webkit': ['acme-webkit', ...chromium],
      netscape: ['netscape']
    }

    for (const mode of ['development', 'production', 'none']) {
      for (const [browser, names] of Object.entries(expected)) {
        expect(envFileCandidates(mode, browser)).toEqual(forNames(mode, names))
        expect(getEnvFileCandidates(browser as never, mode)).toEqual(
          envFileCandidates(mode, browser)
        )
      }

      expect(envFileCandidates(mode)).toEqual(forNames(mode, []))
    }
  })

  it('gives the config of a real build the value the bundle gets', async () => {
    const root = project({...MODE_FILES, 'extension.config.js': MODE_CONFIG})
    fs.writeFileSync(
      path.join(root, 'background.js'),
      'console.log("stage", process.env.EXTENSION_PUBLIC_STAGE)\n'
    )

    const summary = await buildProject(root, {exitOnError: false})
    expect(summary.errors_count).toBe(0)

    const bundle = fs.readFileSync(
      path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
      'utf-8'
    )

    expect(bundle).toContain('from-production')
    expect(fs.readFileSync(path.join(root, 'seen.txt'), 'utf-8')).toBe(
      'from-production'
    )
  }, 120_000)
})

// One process can load two projects (a host looping over them). Each config
// sees its own env files plus what the shell really set, and nothing else.
const SEEN_CONFIG = `module.exports = {
  perfBudgets: {
    seen: [
      process.env.EXTENSION_PUBLIC_ONLY_FIRST,
      process.env.EXTENSION_PUBLIC_BOTH,
      process.env.EXTENSION_PUBLIC_SHELL
    ].map(String).join('|')
  }
}
`
const FIRST_FILES = {
  '.env':
    'EXTENSION_PUBLIC_ONLY_FIRST=first-only\nEXTENSION_PUBLIC_BOTH=first-both\nEXTENSION_PUBLIC_SHELL=first-SHELL\n',
  'extension.config.js': SEEN_CONFIG
}
const SECOND_FILES = {
  '.env':
    'EXTENSION_PUBLIC_BOTH=second-both\nEXTENSION_PUBLIC_SHELL=second-SHELL\n',
  'extension.config.js': SEEN_CONFIG
}

async function seenBy(root: string) {
  const config = (await loadProjectConfigDefaults(root)) as {
    perfBudgets?: {seen?: string}
  }

  return config.perfBudgets?.seen
}

describe('env preload keeps two projects apart', () => {
  it('hides the first project file values from the second config', async () => {
    process.env.EXTENSION_PUBLIC_SHELL = 'from-shell'
    const first = project(FIRST_FILES)
    const second = project(SECOND_FILES)

    expect(await seenBy(first)).toBe('first-only|first-both|from-shell')
    expect(await seenBy(second)).toBe('undefined|second-both|from-shell')

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBeUndefined()
    expect(process.env.EXTENSION_PUBLIC_SHELL).toBe('from-shell')
    expect([...getPreloadedEnvKeys()]).toEqual(['EXTENSION_PUBLIC_BOTH'])
  })

  it('hands a loaded project its own values back when it is asked again', async () => {
    process.env.EXTENSION_PUBLIC_SHELL = 'from-shell'
    const first = project(FIRST_FILES)
    const second = project(SECOND_FILES)

    await seenBy(first)
    await seenBy(second)
    expect(await seenBy(first)).toBe('first-only|first-both|from-shell')

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBe('first-only')
    expect(process.env.EXTENSION_PUBLIC_BOTH).toBe('first-both')
    expect(process.env.EXTENSION_PUBLIC_SHELL).toBe('from-shell')
    expect([...getPreloadedEnvKeys()].sort()).toEqual([
      'EXTENSION_PUBLIC_BOTH',
      'EXTENSION_PUBLIC_ONLY_FIRST'
    ])
  })

  it('leaves a value written over a file value since the last load alone', async () => {
    const first = project(FIRST_FILES)
    const second = project(SECOND_FILES)

    await seenBy(first)
    process.env.EXTENSION_PUBLIC_ONLY_FIRST = 'set-by-the-host'

    expect(await seenBy(second)).toBe(
      'set-by-the-host|second-both|second-SHELL'
    )
  })

  it('takes a project file values out of the host when its session ends', async () => {
    process.env.EXTENSION_PUBLIC_SHELL = 'from-shell'
    const first = project(FIRST_FILES)
    const release = holdPreloadedEnvOf(first)

    await seenBy(first)
    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBe('first-only')

    release()

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBeUndefined()
    expect(process.env.EXTENSION_PUBLIC_BOTH).toBeUndefined()
    expect(process.env.EXTENSION_PUBLIC_SHELL).toBe('from-shell')
    expect([...getPreloadedEnvKeys()]).toEqual([])
  })

  it('keeps the values until the last of two holders gives them back', async () => {
    const first = project(FIRST_FILES)
    const session = holdPreloadedEnvOf(first)
    const build = holdPreloadedEnvOf(first)

    await seenBy(first)
    build()

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBe('first-only')

    // The same holder giving back twice is not a second holder leaving.
    build()

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBe('first-only')

    session()

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBeUndefined()
    expect([...getPreloadedEnvKeys()]).toEqual([])
  })

  it('counts a holder that names the same folder through another spelling', async () => {
    const first = project(FIRST_FILES)
    const session = holdPreloadedEnvOf(path.join(first, 'src', '..'))
    const build = holdPreloadedEnvOf(first)

    await seenBy(first)
    build()

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBe('first-only')

    session()

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBeUndefined()
  })

  it('takes the values out for a holder that never loaded and then failed', async () => {
    const first = project(FIRST_FILES)
    const failedStart = holdPreloadedEnvOf(first)

    failedStart()

    const next = holdPreloadedEnvOf(first)

    await seenBy(first)
    next()

    expect(process.env.EXTENSION_PUBLIC_ONLY_FIRST).toBeUndefined()
  })

  it('leaves the values of another project loaded since then in place', async () => {
    const first = project(FIRST_FILES)
    const second = project(SECOND_FILES)
    const release = holdPreloadedEnvOf(first)

    await seenBy(first)
    await seenBy(second)
    release()

    expect(process.env.EXTENSION_PUBLIC_BOTH).toBe('second-both')
    expect([...getPreloadedEnvKeys()].sort()).toEqual([
      'EXTENSION_PUBLIC_BOTH',
      'EXTENSION_PUBLIC_SHELL'
    ])
  })

  it('keeps each config its own values when two projects load at once', async () => {
    const first = project(FIRST_FILES)
    const second = project(SECOND_FILES)

    expect(await Promise.all([seenBy(first), seenBy(second)])).toEqual([
      'first-only|first-both|first-SHELL',
      'undefined|second-both|second-SHELL'
    ])
  })

  it('leaves what the bundle inlines to the env plugin, shell value first', async () => {
    process.env.EXTENSION_PUBLIC_SHELL = 'from-shell'
    const first = project(FIRST_FILES)
    const second = project(SECOND_FILES)
    fs.writeFileSync(
      path.join(second, 'background.js'),
      'console.log("env", process.env.EXTENSION_PUBLIC_ONLY_FIRST, process.env.EXTENSION_PUBLIC_BOTH, process.env.EXTENSION_PUBLIC_SHELL)\n'
    )

    await seenBy(first)

    const summary = await buildProject(second, {exitOnError: false})
    expect(summary.errors_count).toBe(0)

    const bundle = fs.readFileSync(
      path.join(second, 'dist', 'chrome', 'background', 'service_worker.js'),
      'utf-8'
    )

    expect(bundle).toContain('second-both')
    expect(bundle).toContain('from-shell')
    expect(bundle).not.toContain('first-only')
    expect(bundle).not.toContain('first-both')
    expect(bundle).not.toContain('second-SHELL')
  }, 120_000)
})

// A workspace package whose only env file is .env.defaults still reads the
// workspace root, the folder rule the bundle follows, so both agree.
const WORKSPACE_CONFIG = `module.exports = {
  perfBudgets: {
    seen: [
      process.env.EXTENSION_PUBLIC_STAGE,
      process.env.EXTENSION_PUBLIC_A,
      process.env.EXTENSION_PUBLIC_B,
      process.env.EXTENSION_PUBLIC_D
    ].map(String).join('|')
  }
}
`
const WORKSPACE_ROOT_FILES = {
  '.env.production':
    'EXTENSION_PUBLIC_STAGE=root-production\nEXTENSION_PUBLIC_D=root-D\n',
  '.env.defaults':
    'EXTENSION_PUBLIC_A=root-defaults-A\nEXTENSION_PUBLIC_B=root-defaults-B\n'
}
const PACKAGE_DEFAULTS =
  'EXTENSION_PUBLIC_A=package-defaults-A\nEXTENSION_PUBLIC_D=package-defaults-D\n'

function workspacePackage(
  rootFiles: Record<string, string>,
  packageFiles: Record<string, string>
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-env-workspace-'))
  )
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    "packages:\n  - 'packages/*'\n"
  )

  for (const [name, content] of Object.entries(rootFiles)) {
    fs.writeFileSync(path.join(root, name), content)
  }

  const dir = path.join(root, 'packages', 'extension')
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({private: true, name: 'env-workspace', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'env-workspace',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(
    path.join(dir, 'background.js'),
    'console.log("env", [process.env.EXTENSION_PUBLIC_STAGE, process.env.EXTENSION_PUBLIC_A, process.env.EXTENSION_PUBLIC_B, process.env.EXTENSION_PUBLIC_D].map(String).join("|"))\n'
  )

  for (const [name, content] of Object.entries(packageFiles)) {
    fs.writeFileSync(path.join(dir, name), content)
  }

  return dir
}

describe('env preload in a workspace package', () => {
  it('goes on to the workspace root when the package has only .env.defaults', async () => {
    const dir = workspacePackage(WORKSPACE_ROOT_FILES, {
      '.env.defaults': PACKAGE_DEFAULTS,
      'extension.config.js': WORKSPACE_CONFIG
    })

    expect(await seenBy(dir)).toBe(
      'root-production|package-defaults-A|root-defaults-B|root-D'
    )
  })

  it('reads the package defaults alone when the root has no env file', async () => {
    const dir = workspacePackage(
      {},
      {
        '.env.defaults': PACKAGE_DEFAULTS,
        'extension.config.js': WORKSPACE_CONFIG
      }
    )

    expect(await seenBy(dir)).toBe(
      'undefined|package-defaults-A|undefined|package-defaults-D'
    )
  })

  it('stays in a package that has an env file of its own', async () => {
    const dir = workspacePackage(WORKSPACE_ROOT_FILES, {
      '.env': 'EXTENSION_PUBLIC_STAGE=package-dotenv\n',
      '.env.defaults': PACKAGE_DEFAULTS,
      'extension.config.js': WORKSPACE_CONFIG
    })

    expect(await seenBy(dir)).toBe(
      'package-dotenv|package-defaults-A|undefined|package-defaults-D'
    )
  })

  it('drops the workspace root values before another project loads', async () => {
    process.env.EXTENSION_PUBLIC_B = 'from-shell'
    const dir = workspacePackage(WORKSPACE_ROOT_FILES, {
      '.env.defaults': PACKAGE_DEFAULTS,
      'extension.config.js': WORKSPACE_CONFIG
    })
    const other = project({
      '.env': 'EXTENSION_PUBLIC_D=other-D\n',
      'extension.config.js': WORKSPACE_CONFIG
    })

    expect(await seenBy(dir)).toBe(
      'root-production|package-defaults-A|from-shell|root-D'
    )

    expect(await seenBy(other)).toBe('undefined|undefined|from-shell|other-D')
    expect([...getPreloadedEnvKeys()]).toEqual(['EXTENSION_PUBLIC_D'])
    expect(await seenBy(dir)).toBe(
      'root-production|package-defaults-A|from-shell|root-D'
    )
  })

  it.each([
    [
      'only .env.defaults',
      {'.env.defaults': PACKAGE_DEFAULTS},
      'root-production|package-defaults-A|root-defaults-B|root-D'
    ],
    [
      'an env file of its own',
      {
        '.env': 'EXTENSION_PUBLIC_STAGE=package-dotenv\n',
        '.env.defaults': PACKAGE_DEFAULTS
      },
      'package-dotenv|package-defaults-A|undefined|package-defaults-D'
    ]
  ])(
    'gives the config and the bundle one reading when the package has %s',
    async (_label, packageFiles, expected) => {
      const dir = workspacePackage(WORKSPACE_ROOT_FILES, {
        ...packageFiles,
        'extension.config.js': `${WORKSPACE_CONFIG}
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'seen.txt'), module.exports.perfBudgets.seen)
`
      })

      const summary = await buildProject(dir, {exitOnError: false})
      expect(summary.errors_count).toBe(0)

      const bundle = fs.readFileSync(
        path.join(dir, 'dist', 'chrome', 'background', 'service_worker.js'),
        'utf-8'
      )
      const inlined = expected
        .split('|')
        .map((value) => (value === 'undefined' ? null : value))

      expect(fs.readFileSync(path.join(dir, 'seen.txt'), 'utf-8')).toBe(
        expected
      )

      for (const value of inlined) {
        if (value) expect(bundle).toContain(value)
      }

      for (const absent of [
        'root-production',
        'package-dotenv',
        'root-defaults-A',
        'root-defaults-B',
        'root-D',
        'package-defaults-D'
      ]) {
        if (!inlined.includes(absent)) expect(bundle).not.toContain(absent)
      }
    },
    120_000
  )
})
