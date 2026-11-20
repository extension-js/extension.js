//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import readline from 'node:readline'

export const DEFAULT_PROJECT_NAME = 'my-extension'

// Where the prompt reads and writes, the process streams when left out.
interface PromptIo {
  input?: NodeJS.ReadableStream & {isTTY?: boolean}
  output?: NodeJS.WritableStream & {isTTY?: boolean}
  env?: NodeJS.ProcessEnv
}

function isCI(v: NodeJS.ProcessEnv): boolean {
  return Boolean(
    v.CI ||
      v.GITHUB_ACTIONS ||
      v.GITLAB_CI ||
      v.BUILDKITE ||
      v.CIRCLECI ||
      v.TRAVIS
  )
}

export function canPromptForProjectName({
  input = process.stdin,
  output = process.stdout,
  env = process.env
}: PromptIo = {}): boolean {
  if (isCI(env)) return false

  return Boolean(input.isTTY && output.isTTY)
}

// An empty line takes the default. Ctrl-C answers null, so the caller can
// stop without creating anything.
export function askProjectName(
  question: string,
  {input = process.stdin, output = process.stdout}: PromptIo = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({input, output})
    let settled = false

    const finish = (answer: string | null) => {
      if (settled) return

      settled = true

      try {
        rl.close()
      } catch {
        // Ignore
      }

      resolve(answer)
    }

    rl.question(question, (answer) => {
      const name = String(answer || '').trim()
      finish(name || DEFAULT_PROJECT_NAME)
    })

    rl.on('SIGINT', () => finish(null))
    rl.on('close', () => finish(null))
  })
}

export function createCommandFor(template: string | undefined): string {
  const name = String(template || '').trim() || 'react'

  return `npx extension@latest create ${DEFAULT_PROJECT_NAME} --template=${name}`
}
