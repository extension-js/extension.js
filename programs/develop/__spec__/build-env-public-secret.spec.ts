import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {looksLikeSecretName} from '../plugin-compilation/env'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(env: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-secret-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'public-secret', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'public secret',
      version: '1.0.0',
      background: {service_worker: 'sw.js'}
    })
  )

  fs.writeFileSync(
    path.join(root, 'sw.js'),
    'console.log(import.meta.env.EXTENSION_PUBLIC_OPENAI_API_KEY)\n'
  )

  fs.writeFileSync(path.join(root, '.env'), env)

  return root
}

async function build(root: string, mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')
  const printed: string[] = []

  const capture = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const log = vi.spyOn(console, 'log').mockImplementation(capture)
  const warn = vi.spyOn(console, 'warn').mockImplementation(capture)
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chromium',
      silent: false,
      install: false,
      mode,
      exitOnError: false
    } as never)

    return {
      summary: summary as {warnings_count?: number},
      // eslint-disable-next-line no-control-regex
      text: printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    }
  } finally {
    log.mockRestore()
    warn.mockRestore()
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('a public env variable whose name looks secret', () => {
  it('matches whole name segments only', () => {
    for (const name of [
      'EXTENSION_PUBLIC_OPENAI_API_KEY',
      'EXTENSION_PUBLIC_GITHUB_TOKEN',
      'EXTENSION_PUBLIC_CLIENT_SECRET',
      'EXTENSION_PUBLIC_DB_PASSWORD',
      'EXTENSION_PUBLIC_PRIVATE_KEY',
      'EXTENSION_PUBLIC_AWS_ACCESS_KEY',
      'EXTENSION_PUBLIC_AUTH_KEY'
    ]) {
      expect(looksLikeSecretName(name), name).toBe(true)
    }

    for (const name of [
      'EXTENSION_PUBLIC_KEYBOARD_LAYOUT',
      'EXTENSION_PUBLIC_TOKENIZER_URL',
      'EXTENSION_PUBLIC_MAP_KEY_COLOR',
      'EXTENSION_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      'EXTENSION_PUBLIC_DESCRIPTION_TEXT',
      'EXTENSION_PUBLIC_KEY'
    ]) {
      expect(looksLikeSecretName(name), name).toBe(false)
    }
  })

  it('warns in a production build, naming the variable, and the value still ships as before', async () => {
    const root = project('EXTENSION_PUBLIC_OPENAI_API_KEY=sk-test-value\n')
    const {summary, text} = await build(root, 'production')

    expect(summary.warnings_count).toBe(1)
    expect(text).toContain(
      'EXTENSION_PUBLIC_OPENAI_API_KEY looks like a secret'
    )

    expect(text).toContain('Keep the secret on a server')

    const bundle = fs
      .readdirSync(path.join(root, 'dist', 'chromium'), {recursive: true})
      .map(String)
      .filter((file) => file.endsWith('.js'))
      .map((file) =>
        fs.readFileSync(path.join(root, 'dist', 'chromium', file), 'utf8')
      )
      .join('\n')

    // The build does not hide the problem it reports: the value is inlined.
    expect(bundle).toContain('sk-test-value')
  }, 120_000)

  it('says nothing for an empty value or in a development build', async () => {
    const empty = await build(
      project('EXTENSION_PUBLIC_OPENAI_API_KEY=\n'),
      'production'
    )
    expect(empty.summary.warnings_count).toBe(0)

    const development = await build(
      project('EXTENSION_PUBLIC_OPENAI_API_KEY=sk-test-value\n'),
      'development'
    )
    expect(development.text).not.toContain('looks like a secret')
  }, 120_000)
})
