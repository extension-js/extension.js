import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

// A caller that asks for a silent build reads the summary it gets back, so
// nothing belongs on stdout. A failure still reaches stderr.
const tempFolder = trackTempFolders()

afterEach(() => {
  vi.restoreAllMocks()
})

function project(permissions: unknown) {
  const root = tempFolder('extjs-silent-')
  const write = (file: string, text: string) =>
    fs.writeFileSync(path.join(root, file), text)

  write(
    'package.json',
    JSON.stringify({private: true, name: 'silent', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Silent',
      version: '1.0.0',
      permissions,
      background: {service_worker: 'background.js'}
    })
  )

  write('background.js', 'console.log("background")\n')

  return root
}

async function build(root: string, options: Record<string, unknown>) {
  const {extensionBuild, resetBuildToolchainLine} = await import(
    '../command-build'
  )
  const stdout: string[] = []
  const stderr: string[] = []

  resetBuildToolchainLine()
  vi.spyOn(console, 'log').mockImplementation((...parts) => {
    stdout.push(parts.map(String).join(' '))
  })

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))

    return true
  })

  for (const method of ['warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...parts) => {
      stderr.push(parts.map(String).join(' '))
    })
  }

  let summary: Awaited<ReturnType<typeof extensionBuild>> | undefined
  let failure: unknown

  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      install: false,
      mode: 'production',
      zip: true,
      exitOnError: false,
      ...options
    } as never)
  } catch (error) {
    failure = error
  } finally {
    vi.restoreAllMocks()
  }

  return {
    summary,
    failure,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n')
  }
}

describe('build: silent prints nothing on stdout (real rspack)', () => {
  it('prints no line for a build that warns and packages a zip', async () => {
    // A string where an array belongs is repaired with a warning.
    const built = await build(project('storage'), {silent: true})

    expect(built.failure).toBeUndefined()
    expect(built.stdout).toBe('')
    expect(built.summary?.errors_count).toBe(0)
    expect(built.summary?.warnings_count).toBeGreaterThan(0)
    expect(built.summary?.zip_artifacts?.length).toBe(1)
  }, 120_000)

  it('prints the same build when silent is off', async () => {
    const built = await build(project('storage'), {silent: false})

    expect(built.stdout).toContain('built for production in')
    expect(built.stdout).toContain('Repaired the permissions field')
    expect(built.stdout).toContain('Packaged')
  }, 120_000)

  it('takes silent from the project config too', async () => {
    const root = project(['storage'])

    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      'module.exports = {commands: {build: {silent: true}}}\n'
    )

    const built = await build(root, {})

    expect(built.failure).toBeUndefined()
    expect(built.stdout).toBe('')
  }, 120_000)

  it('still reports a failed build on stderr, and prints again afterwards', async () => {
    const root = project(['storage'])

    fs.writeFileSync(path.join(root, 'background.js'), 'import "./gone.js"\n')

    const failed = await build(root, {silent: true})

    expect(failed.failure).toBeDefined()
    expect(failed.stdout).toBe('')
    expect(failed.stderr).toContain('Build failed')

    const next = await build(project(['storage']), {silent: false})

    expect(next.stdout).toContain('built for production in')
  }, 120_000)

  it('leaves the build leg of start as it prints today', async () => {
    const built = await build(project(['storage']), {
      silent: true,
      metadataCommand: 'start'
    })

    expect(built.stdout).toContain('built for production in')
  }, 120_000)
})
