import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {browserConfig} from '../../run-chromium/chromium-launch/browser-config'
import {getExtensionOutputPath} from '../../run-chromium/chromium-launch/extension-output-path'

function stripAnsi(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

describe('a --profile path that is a file', () => {
  let scratch: string

  beforeEach(() => {
    scratch = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-file-'))
    )

    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(scratch, {recursive: true, force: true})
  })

  it('is refused as E_INVALID_OPTION, naming the path and the flag, and the file is left as it was', () => {
    const project = path.join(scratch, 'project')
    const profile = path.join(scratch, 'profile.txt')
    fs.mkdirSync(project)
    fs.writeFileSync(profile, 'not a folder')

    let caught: (Error & {code?: string}) | undefined

    try {
      browserConfig(
        {
          options: {
            context: project,
            output: {path: path.join(project, 'dist', 'chrome')}
          }
        } as never,
        {browser: 'chrome', extension: [], profile} as never
      )
    } catch (error) {
      caught = error as Error & {code?: string}
    }

    expect(caught?.code).toBe('E_INVALID_OPTION')
    expect(stripAnsi(String(caught?.message)).split('\n').slice(1)).toEqual([
      `PATH ${profile}`,
      'Pass --profile a directory, or a path that can become one.'
    ])

    expect(fs.readFileSync(profile, 'utf8')).toBe('not a folder')
  })
})

describe('the output folder a Chromium launch assumes when the compile names none', () => {
  // Pins today's behavior. Ledger 1374 D16.
  it('is <cwd>/dist for the extension and <cwd>/dist/chrome for the profile root', () => {
    const cwd = process.cwd()
    const sessionRoot = path.join(cwd, 'dist', 'extension-js')
    const existedBefore = fs.existsSync(sessionRoot)

    expect(getExtensionOutputPath({options: {}} as never, undefined)).toBe(
      path.join(cwd, 'dist')
    )

    // A plan only: nothing is created under the working directory.
    const flags = browserConfig(
      {options: {}} as never,
      {browser: 'chrome', extension: []} as never,
      {provision: false}
    )
    const dataDir = String(
      flags.find((flag) => flag.startsWith('--user-data-dir='))
    ).replace('--user-data-dir=', '')

    // The profile root sits beside the output folder, so this one says the
    // output is <cwd>/dist/chrome where the other said <cwd>/dist.
    expect(path.dirname(dataDir)).toBe(
      path.join(sessionRoot, 'profiles', 'chrome-profile')
    )

    expect(fs.existsSync(sessionRoot)).toBe(existedBefore)
  })
})
