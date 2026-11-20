import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  readBrowserInstall,
  resetBrowserInstall
} from '../../../helpers/browser-install-outcome'
import {
  askToInstall,
  canPromptForInstall,
  type InstallableTarget,
  offerManagedInstall
} from '../../browsers-lib/first-run-install'

const GUARD_KEYS = [
  'EXTENSION_NO_INSTALL_PROMPT',
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'TRAVIS'
] as const

let savedEnv: Record<string, string | undefined> = {}
let savedStdin: boolean | undefined
let savedStdout: boolean | undefined

// The guards read the live process, so each case restores what it changed.
function clearGuards(): void {
  for (const key of GUARD_KEYS) delete process.env[key]
}

function setTty(value: boolean): void {
  ;(process.stdin as {isTTY?: boolean}).isTTY = value
  ;(process.stdout as {isTTY?: boolean}).isTTY = value
}

beforeEach(() => {
  savedEnv = {}
  for (const key of GUARD_KEYS) savedEnv[key] = process.env[key]
  savedStdin = (process.stdin as {isTTY?: boolean}).isTTY
  savedStdout = (process.stdout as {isTTY?: boolean}).isTTY
})

afterEach(() => {
  for (const key of GUARD_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  ;(process.stdin as {isTTY?: boolean}).isTTY = savedStdin
  ;(process.stdout as {isTTY?: boolean}).isTTY = savedStdout
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('canPromptForInstall', () => {
  it('refuses in CI even on a TTY', () => {
    setTty(true)
    clearGuards()
    process.env.CI = 'true'
    expect(canPromptForInstall()).toBe(false)

    clearGuards()
    process.env.GITHUB_ACTIONS = 'true'
    expect(canPromptForInstall()).toBe(false)
  })

  it('refuses when the opt-out is set', () => {
    setTty(true)
    clearGuards()
    process.env.EXTENSION_NO_INSTALL_PROMPT = '1'
    expect(canPromptForInstall()).toBe(false)
  })

  it('refuses when either end of the pipe is not a terminal', () => {
    clearGuards()
    setTty(false)
    expect(canPromptForInstall()).toBe(false)
    ;(process.stdin as {isTTY?: boolean}).isTTY = true
    ;(process.stdout as {isTTY?: boolean}).isTTY = false
    expect(canPromptForInstall()).toBe(false)
  })

  it('accepts an interactive terminal with no guard set', () => {
    clearGuards()
    setTty(true)
    expect(canPromptForInstall()).toBe(true)
  })
})

describe('askToInstall', () => {
  async function answerWith(answer: string): Promise<boolean> {
    const readline = await import('node:readline')
    vi.spyOn(readline.default, 'createInterface').mockReturnValue({
      question: (_q: string, cb: (value: string) => void) => cb(answer),
      close: () => {},
      on: () => {}
    } as unknown as ReturnType<typeof readline.default.createInterface>)

    return askToInstall('Download? ')
  }

  it('treats an empty answer as yes, since the question blocks the run', async () => {
    await expect(answerWith('')).resolves.toBe(true)
  })

  it('accepts y and yes', async () => {
    await expect(answerWith('y')).resolves.toBe(true)
    await expect(answerWith('YES')).resolves.toBe(true)
  })

  it('declines on n and no, whatever the case and spacing', async () => {
    await expect(answerWith('n')).resolves.toBe(false)
    await expect(answerWith('  No  ')).resolves.toBe(false)
  })
})

// No case here may ask the terminal or download: each one hands in its own
// question and installer, and the real ones are never the defaults in use.
describe('offerManagedInstall', () => {
  const never = () => {
    throw new Error('this case must not prompt or install')
  }

  function seams(answer: boolean, outcome: 'done' | Error = 'done') {
    return {
      ask: vi.fn(async (_question: string) => answer),
      install: vi.fn(async (_target: InstallableTarget) => {
        if (outcome !== 'done') throw outcome
      })
    }
  }

  beforeEach(() => {
    resetBrowserInstall()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('never prompts when the caller says the session cannot prompt', async () => {
    await expect(
      offerManagedInstall('chrome', {
        canPrompt: () => false,
        ask: never,
        install: never
      })
    ).resolves.toBe(false)

    expect(readBrowserInstall()).toBe(null)
  })

  it('asks the live session by default, and a piped one is never prompted', async () => {
    clearGuards()
    setTty(false)
    const {ask, install} = seams(true)

    await expect(offerManagedInstall('chrome', {ask, install})).resolves.toBe(
      false
    )

    expect(ask).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
  })

  it('installs the offered browser once on a yes', async () => {
    const {ask, install} = seams(true)

    await expect(
      offerManagedInstall('chrome', {canPrompt: () => true, ask, install})
    ).resolves.toBe(true)

    expect(ask).toHaveBeenCalledTimes(1)
    expect(install.mock.calls).toEqual([['chrome']])
    expect(readBrowserInstall()).toMatchObject({
      outcome: 'accepted',
      browser: 'chrome'
    })
  })

  it('installs nothing on a no', async () => {
    const {ask, install} = seams(false)

    await expect(
      offerManagedInstall('chrome', {canPrompt: () => true, ask, install})
    ).resolves.toBe(false)

    expect(install).not.toHaveBeenCalled()
    expect(readBrowserInstall()).toMatchObject({outcome: 'declined'})
  })

  it('reports a failed install as false and never throws', async () => {
    const {ask, install} = seams(true, new Error('404 from CDN'))
    const printed = vi.mocked(console.log)

    await expect(
      offerManagedInstall('chrome', {canPrompt: () => true, ask, install})
    ).resolves.toBe(false)

    expect(readBrowserInstall()).toMatchObject({outcome: 'failed'})
    expect(printed.mock.calls.flat().join('\n')).toContain('404 from CDN')
  })
})
