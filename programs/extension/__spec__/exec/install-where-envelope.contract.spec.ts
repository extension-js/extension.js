import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs
  return path.join(cliRoot(), 'dist', 'cli.js')
}

function run(args: string[]) {
  return spawnSync(process.execPath, [cliBin(), ...args], {
    cwd: cliRoot(),
    encoding: 'utf8',
    env: {...process.env, EXTENSION_ENV: 'test'}
  })
}

function stdoutFrames(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('install/uninstall refusal codes under --output json', () => {
  // Scripts branch on the envelope code alone. Three situations, three codes:
  //   unknown name       → E_UNSUPPORTED_BROWSER
  //   known, never fetch → E_BROWSER_NOT_INSTALLABLE
  //   managed download   → E_BROWSER_DOWNLOAD (covered in unit tests)
  // Install and uninstall, with and without --where, must agree.

  it('frames an unknown name as E_UNSUPPORTED_BROWSER', () => {
    for (const command of ['install', 'uninstall'] as const) {
      const result = run([command, 'netscape', '--output', 'json'])
      expect(result.status).toBe(1)
      const frames = stdoutFrames(result.stdout)
      expect(frames).toHaveLength(1)
      expect(frames[0].command).toBe(command)
      expect(frames[0].status).toBe('usage')
      expect((frames[0].error as {code: string}).code).toBe(
        'E_UNSUPPORTED_BROWSER'
      )
      expect(String((frames[0].error as {message: string}).message)).toMatch(
        /netscape/i
      )
    }
  })

  it('frames brave as E_BROWSER_NOT_INSTALLABLE, never a download error', () => {
    for (const args of [
      ['install', 'brave', '--output', 'json'],
      ['install', 'brave', '--where', '--output', 'json'],
      ['uninstall', 'brave', '--output', 'json'],
      ['uninstall', 'brave', '--where', '--output', 'json']
    ]) {
      const result = run(args)
      expect(result.status).toBe(1)
      const frames = stdoutFrames(result.stdout)
      expect(frames).toHaveLength(1)
      const error = frames[0].error as Record<string, unknown>
      expect(error.code).toBe('E_BROWSER_NOT_INSTALLABLE')
      expect(String(error.message)).toMatch(
        /never downloads|cannot be installed/i
      )
      expect(String(error.message)).not.toMatch(/Retry/)
      expect(result.stdout).not.toMatch(/at normalizeBrowserName/)
    }
  })

  it('frames safari as E_BROWSER_NOT_INSTALLABLE with the Xcode guidance', () => {
    const result = run(['install', 'safari', '--where', '--output', 'json'])

    expect(result.status).toBe(1)
    const frames = stdoutFrames(result.stdout)
    expect(frames).toHaveLength(1)
    expect((frames[0].error as {code: string}).code).toBe(
      'E_BROWSER_NOT_INSTALLABLE'
    )
    expect(String((frames[0].error as {message: string}).message)).toMatch(
      /Safari|Xcode/i
    )
  })

  it('accepts comma lists on uninstall the same as install', () => {
    const installWhere = run([
      'install',
      'chrome,edge',
      '--where',
      '--output',
      'json'
    ])
    const uninstallWhere = run([
      'uninstall',
      'chrome,edge',
      '--where',
      '--output',
      'json'
    ])

    expect(installWhere.status).toBe(0)
    expect(uninstallWhere.status).toBe(0)

    const installPaths = (
      stdoutFrames(installWhere.stdout)[0].value as {paths: string[]}
    ).paths
    const uninstallPaths = (
      stdoutFrames(uninstallWhere.stdout)[0].value as {paths: string[]}
    ).paths
    expect(installPaths).toEqual(uninstallPaths)
    expect(installPaths).toHaveLength(2)
    expect(installPaths[0]).toMatch(/chrome/)
    expect(installPaths[1]).toMatch(/edge/)
  })

  it('still locates managed browsers as a success envelope', () => {
    const result = run(['install', 'chrome', '--where', '--output', 'json'])

    expect(result.status).toBe(0)
    const frames = stdoutFrames(result.stdout)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      schema: 1,
      ok: true,
      command: 'install',
      status: 'located'
    })
    const value = frames[0].value as {paths: string[]}
    expect(Array.isArray(value.paths)).toBe(true)
    expect(value.paths.length).toBe(1)
    expect(value.paths[0]).toMatch(/chrome/)
  })
})
