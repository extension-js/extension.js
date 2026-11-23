import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {
  pinnedBinaryExitNote,
  pinnedBinarySpawnError,
  spawnRefusalWords
} from '../../browsers-lib/pinned-binary'
import {launchFailureCode} from '../../browsers-lib/ready-stamp'
import {spawnChromiumProcess} from '../../run-chromium/chromium-launch/wsl-support'

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

// The shape Node gives a spawn refusal: an errno name and the spawn syscall.
function spawnRefusal(code: string, file?: string) {
  return Object.assign(new Error(`spawn ${file ? `${file} ` : ''}${code}`), {
    code,
    syscall: file ? `spawn ${file}` : 'spawn'
  })
}

describe('the words for a spawn refusal', () => {
  it.each([
    [
      'UNKNOWN',
      'win32',
      'Windows could not start this file as a program (spawn UNKNOWN)'
    ],
    [
      'UNKNOWN',
      'linux',
      'the system could not start this file (spawn UNKNOWN)'
    ],
    [
      'ENOEXEC',
      'darwin',
      'this file is not in a format the system can run (spawn ENOEXEC)'
    ],
    [
      'EFTYPE',
      'darwin',
      'this file is not in a format the system can run (spawn EFTYPE)'
    ],
    [
      'EACCES',
      'linux',
      'the system denied permission to run this file (spawn EACCES)'
    ],
    [
      'ENOENT',
      'linux',
      'the file, or the interpreter its first line names, was not found (spawn ENOENT)'
    ],
    [
      'Unknown system error -86',
      'darwin',
      'this file is built for another processor (spawn Unknown system error -86)'
    ]
  ] as const)('reads %s on %s in plain words', (code, platform, words) => {
    expect(spawnRefusalWords(spawnRefusal(code), platform)).toBe(words)
  })

  it('reads nothing into an error that is no spawn refusal', () => {
    expect(spawnRefusalWords(new Error('the profile is locked'))).toBeNull()
    expect(
      spawnRefusalWords(Object.assign(new Error('x'), {code: 'EACCES'}))
    ).toBeNull()

    expect(spawnRefusalWords(undefined)).toBeNull()
  })
})

describe('a pinned binary the system will not run', () => {
  const file = path.join(os.tmpdir(), 'fake-browser.exe')

  it.each([
    [
      '--chromium-binary',
      'Pass --chromium-binary <abs-path> with a working browser binary.'
    ],
    [
      '--gecko-binary',
      'Pass --gecko-binary <abs-path> with a working browser binary.'
    ],
    [
      'CHROMIUM_BINARY',
      'Set CHROMIUM_BINARY to a working browser binary, or unset it to run the managed or system browser.'
    ]
  ])('names the file and %s, which pinned it', (pinnedBy, fix) => {
    const refused = spawnRefusal('ENOEXEC')
    const error = pinnedBinarySpawnError(refused, {
      path: file,
      pinnedBy
    }) as Error & {code?: string; cause?: unknown}

    expect(stripAnsi(error.message)).toBe(
      'The pinned browser binary could not be run, this file is not in a format the system can run (spawn ENOEXEC).\n' +
        `PINNED BY ${pinnedBy} ${file}\n` +
        `The file may not be a browser. ${fix}`
    )

    expect(error.cause).toBe(refused)
    // The errno rides along and is no launcher code: E_BROWSER_LAUNCH stands.
    expect(error.code).toBe('ENOEXEC')
    expect(launchFailureCode(error)).toBeUndefined()
  })

  it('leaves a binary nothing pinned, and any other failure, as thrown', () => {
    const refused = spawnRefusal('ENOEXEC')
    const locked = new Error('the profile is locked')

    expect(pinnedBinarySpawnError(refused, {path: file})).toBe(refused)
    expect(
      pinnedBinarySpawnError(locked, {path: file, pinnedBy: '--gecko-binary'})
    ).toBe(locked)

    expect(pinnedBinaryExitNote({path: file})).toBe('')
  })
})

// The hosted Windows runner answered spawn UNKNOWN for this exact file. No
// other system refuses it the same way, so the row runs where it is true.
describe.runIf(process.platform === 'win32')('a text file named .exe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-fake-exe-'))

  afterAll(() => fs.rmSync(root, {recursive: true, force: true}))

  it('is refused by Windows in words that name the file and the flag', async () => {
    const file = path.join(root, 'fake-browser.exe')
    fs.writeFileSync(file, 'not a browser\n')

    const refused = await spawnChromiumProcess({
      binary: file,
      launchArgs: ['--version'],
      stdio: 'ignore',
      browser: 'chromium'
    }).then(
      () => {
        throw new Error('Windows ran a text file')
      },
      (error: unknown) => error
    )

    const message = stripAnsi(
      (
        pinnedBinarySpawnError(refused, {
          path: file,
          pinnedBy: '--chromium-binary'
        }) as Error
      ).message
    )

    expect(message).toContain('Windows could not start this file as a program')
    expect(message).toContain(`PINNED BY --chromium-binary ${file}`)
  })
})
