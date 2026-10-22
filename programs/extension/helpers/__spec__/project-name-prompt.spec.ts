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
  it('never prompts inside a test run', () => {
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
