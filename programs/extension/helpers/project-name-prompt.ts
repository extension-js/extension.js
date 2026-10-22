//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import readline from 'node:readline'

export const DEFAULT_PROJECT_NAME = 'my-extension'

function isCI(): boolean {
  const v = process.env

  return Boolean(
    v.CI ||
      v.GITHUB_ACTIONS ||
      v.GITLAB_CI ||
      v.BUILDKITE ||
      v.CIRCLECI ||
      v.TRAVIS
  )
}

export function canPromptForProjectName(): boolean {
  if (process.env.VITEST || process.env.VITEST_WORKER_ID) return false
  if (isCI()) return false

  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

// An empty line takes the default. Ctrl-C answers null, so the caller can
// stop without creating anything.
export function askProjectName(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
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
