import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest'
import {getEnvFileCandidates} from '../../plugin-compilation/env'
import {
  envFileCandidates,
  loadCommandConfig,
  loadProjectConfigDefaults
} from '../config-loader'

// Env files reach the config in the usual layers: .env.defaults only fills
// gaps, .env is the base, .env.local overrides it, and a value the shell
// exported beats every file.
const KEYS = [
  'EXTENSION_PUBLIC_A',
  'EXTENSION_PUBLIC_B',
  'EXTENSION_PUBLIC_D',
  'EXTENSION_PUBLIC_E',
  'EXTENSION_PUBLIC_STAGE',
  'EXTENSION_PUBLIC_SHELL'
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
    const {extensionBuild} = await import('../../command-build')
    const previous = process.env.VITEST
    process.env.VITEST = 'true'

    try {
      const summary = await extensionBuild(root, {
        browser: 'chrome',
        silent: true,
        install: false,
        mode: 'production',
        exitOnError: false
      } as any)
      expect(summary.errors_count).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.VITEST
      else process.env.VITEST = previous
    }

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

    const {extensionBuild} = await import('../../command-build')
    const previous = process.env.VITEST
    process.env.VITEST = 'true'

    try {
      const summary = await extensionBuild(root, {
        browser: 'chrome',
        silent: true,
        install: false,
        exitOnError: false
      } as any)
      expect(summary.errors_count).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.VITEST
      else process.env.VITEST = previous
    }

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
