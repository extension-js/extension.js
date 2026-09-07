//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import readline from 'node:readline'
import {recordBrowserInstall} from '../../helpers/browser-install-outcome'
import {humanLine} from '../../helpers/messaging'
import * as messages from './messages'

export type InstallableTarget = 'chrome' | 'chromium' | 'edge' | 'firefox'

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

// A prompt needs a human on both ends of the pipe. A test run, a CI job or a
// piped session takes the old path: print the install command and stop.
export function canPromptForInstall(): boolean {
  if (process.env.VITEST || process.env.VITEST_WORKER_ID) return false
  if (process.env.EXTENSION_NO_INSTALL_PROMPT) return false
  if (isCI()) return false
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

// Reads one line. Anything but an explicit no means yes, since the question
// is the last thing between the developer and a running extension.
export function askToInstall(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    const finish = (answer: boolean) => {
      try {
        rl.close()
      } catch {
        // Ignore
      }
      resolve(answer)
    }

    rl.question(question, (answer) => {
      const normalized = String(answer || '')
        .trim()
        .toLowerCase()
      finish(normalized !== 'n' && normalized !== 'no')
    })

    rl.on('SIGINT', () => finish(false))
  })
}

// Downloads the managed browser the session asked for and reports whether the
// caller can retry resolution. Never throws: a failed install falls back to
// the printed install command.
export async function offerManagedInstall(
  target: InstallableTarget
): Promise<boolean> {
  if (!canPromptForInstall()) return false

  humanLine(messages.firstRunInstallOffer(target))
  recordBrowserInstall('offered', target)
  const accepted = await askToInstall(messages.firstRunInstallQuestion(target))
  if (!accepted) {
    recordBrowserInstall('declined', target)
    humanLine(messages.firstRunInstallDeclined(target))
    return false
  }

  const startedAt = Date.now()
  try {
    const {extensionInstall} = await import('extension-install')
    await extensionInstall({browser: target})
    recordBrowserInstall('accepted', target, (Date.now() - startedAt) / 1000)
    return true
  } catch (error) {
    recordBrowserInstall('failed', target, (Date.now() - startedAt) / 1000)
    humanLine(
      messages.firstRunInstallFailed(
        target,
        error instanceof Error ? error.message : String(error)
      )
    )
    return false
  }
}
