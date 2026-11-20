import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  askProjectName,
  canPromptForProjectName,
  createCommandFor
} from '../project-name-prompt'

afterEach(() => {
  vi.restoreAllMocks()
})

async function answerWith(answer: string | 'SIGINT'): Promise<string | null> {
  const readline = await import('node:readline')
  const handlers: Record<string, () => void> = {}
  vi.spyOn(readline.default, 'createInterface').mockReturnValue({
    question: (_q: string, cb: (value: string) => void) => {
      if (answer === 'SIGINT') setTimeout(() => handlers.SIGINT?.(), 0)
      else cb(answer)
    },
    close: () => {},
    on: (event: string, handler: () => void) => {
      handlers[event] = handler
    }
  } as unknown as ReturnType<typeof readline.default.createInterface>)

  return askProjectName('Project name: ')
}

describe('askProjectName', () => {
  it('takes my-extension on an empty line', async () => {
    await expect(answerWith('')).resolves.toBe('my-extension')
  })

  it('returns the typed name trimmed', async () => {
    await expect(answerWith('  tab-notes  ')).resolves.toBe('tab-notes')
  })

  it('answers null on Ctrl-C so nothing is created', async () => {
    const pending = answerWith('SIGINT')
    await expect(pending).resolves.toBeNull()
  })
})

describe('canPromptForProjectName', () => {
  const terminal = {isTTY: true} as NodeJS.ReadStream & NodeJS.WriteStream
  const pipe = {isTTY: false} as NodeJS.ReadStream & NodeJS.WriteStream

  it('asks a person whose input and output are both a terminal', () => {
    expect(
      canPromptForProjectName({input: terminal, output: terminal, env: {}})
    ).toBe(true)
  })

  it('decides by the streams, not by a variable a test runner sets', () => {
    expect(
      canPromptForProjectName({
        input: terminal,
        output: terminal,
        env: {VITEST: 'true', VITEST_WORKER_ID: '1'}
      })
    ).toBe(true)
  })

  it('does not ask when either stream is a pipe', () => {
    expect(
      canPromptForProjectName({input: pipe, output: terminal, env: {}})
    ).toBe(false)

    expect(
      canPromptForProjectName({input: terminal, output: pipe, env: {}})
    ).toBe(false)
  })

  it('does not ask on CI, terminal or not', () => {
    expect(
      canPromptForProjectName({
        input: terminal,
        output: terminal,
        env: {GITHUB_ACTIONS: 'true'}
      })
    ).toBe(false)
  })

  it('does not ask from a spec worker, whose input is never a terminal', () => {
    expect(process.stdin.isTTY).toBeFalsy()
    expect(canPromptForProjectName()).toBe(false)
  })
})

describe('createCommandFor', () => {
  it('names react when no template was passed', () => {
    expect(createCommandFor(undefined)).toBe(
      'npx extension@latest create my-extension --template=react'
    )
  })

  it('keeps the template the caller passed', () => {
    expect(createCommandFor('svelte')).toBe(
      'npx extension@latest create my-extension --template=svelte'
    )
  })
})
