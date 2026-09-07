import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  askToInstall,
  canPromptForInstall,
  offerManagedInstall
} from '../browsers-lib/first-run-install'

const GUARD_KEYS = [
  'VITEST',
  'VITEST_WORKER_ID',
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
  it('refuses inside a test run', () => {
    setTty(true)
    clearGuards()
    process.env.VITEST = 'true'
    expect(canPromptForInstall()).toBe(false)
  })

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

describe('offerManagedInstall', () => {
  it('never prompts when the session cannot prompt', async () => {
    setTty(true)
    clearGuards()
    process.env.VITEST = 'true'
    await expect(offerManagedInstall('chrome')).resolves.toBe(false)
  })
})
