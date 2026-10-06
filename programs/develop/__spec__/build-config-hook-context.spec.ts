import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const LOCALES = ['en', 'de', 'fr', 'pt_BR']

function project(config: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-hook-context-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'hook-context', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: '__MSG_hookContextName__',
      version: '1.0.0',
      default_locale: 'en',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), "console.log('bg')\n")

  for (const locale of LOCALES) {
    const dir = path.join(root, '_locales', locale)
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(
      path.join(dir, 'messages.json'),
      JSON.stringify({hookContextName: {message: `Hook context ${locale}`}})
    )
  }

  fs.writeFileSync(path.join(root, 'extension.config.js'), config)

  return root
}

function keepLocalesConfig(keep: Record<string, string[]>) {
  return [
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    `const KEEP = ${JSON.stringify(keep)}`,
    'function seen(hook, context) {',
    "  const file = path.join(__dirname, 'hooks-seen.json')",
    '  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {}',
    '  all[hook] = context',
    '  fs.writeFileSync(file, JSON.stringify(all))',
    '}',
    'module.exports = {',
    '  config: (config, context) => {',
    "    seen('config', context)",
    '    const keep = KEEP[context.browser]',
    '    if (!keep) return config',
    '    config.plugins.push({',
    '      apply(compiler) {',
    "        compiler.hooks.thisCompilation.tap('keep-locales', (compilation) => {",
    '          compilation.hooks.processAssets.tap(',
    "            {name: 'keep-locales', stage: compiler.rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE},",
    '            () => {',
    '              for (const name of Object.keys(compilation.assets)) {',
    '                const match = /^_locales\\/([^/]+)\\//.exec(name)',
    '                if (match && !keep.includes(match[1])) compilation.deleteAsset(name)',
    '              }',
    '            }',
    '          )',
    '        })',
    '      }',
    '    })',
    '    return config',
    '  },',
    '  configResolved: (config, context) => {',
    "    seen('configResolved', context)",
    '    return config',
    '  }',
    '}',
    ''
  ].join('\n')
}

async function build(root: string, browser: 'chrome' | 'edge') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser,
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

function seen(root: string) {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'hooks-seen.json'), 'utf8')
  ) as Record<string, unknown>
}

function emittedLocales(root: string, browser: string) {
  return fs.readdirSync(path.join(root, 'dist', browser, '_locales')).sort()
}

describe('config hooks receive the target browser', () => {
  it('tells config and configResolved the browser, mode and command of each build', async () => {
    const root = project(keepLocalesConfig({edge: ['en', 'de']}))

    expect((await build(root, 'chrome')).errors_count).toBe(0)
    expect(seen(root)).toEqual({
      config: {browser: 'chrome', mode: 'production', command: 'build'},
      configResolved: {browser: 'chrome', mode: 'production', command: 'build'}
    })

    expect(emittedLocales(root, 'chrome')).toEqual(['de', 'en', 'fr', 'pt_BR'])

    fs.rmSync(path.join(root, 'hooks-seen.json'))

    expect((await build(root, 'edge')).errors_count).toBe(0)
    expect(seen(root)).toEqual({
      config: {browser: 'edge', mode: 'production', command: 'build'},
      configResolved: {browser: 'edge', mode: 'production', command: 'build'}
    })

    expect(emittedLocales(root, 'edge')).toEqual(['de', 'en'])
    expect(
      fs.readFileSync(
        path.join(root, 'dist', 'edge', '_locales', 'de', 'messages.json'),
        'utf8'
      )
    ).toContain('Hook context de')
  }, 180_000)

  it('fails the build and names the locale when the filter drops the default one', async () => {
    const root = project(keepLocalesConfig({edge: ['de']}))
    const printed: string[] = []

    const capture = (...args: unknown[]) => {
      printed.push(args.map(String).join(' '))
    }

    const error = vi.spyOn(console, 'error').mockImplementation(capture)
    const log = vi.spyOn(console, 'log').mockImplementation(capture)

    try {
      await expect(build(root, 'edge')).rejects.toThrow(
        'Build failed with errors'
      )
    } finally {
      error.mockRestore()
      log.mockRestore()
    }

    // eslint-disable-next-line no-control-regex
    const text = printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    expect(text).toContain(
      'The default locale was removed from the build output.'
    )

    expect(text).toContain('NOT FOUND _locales/en/messages.json')
    expect(fs.existsSync(path.join(root, 'dist', 'edge', '_locales'))).toBe(
      false
    )
  }, 120_000)
})
