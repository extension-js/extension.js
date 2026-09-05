//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn} from 'cross-spawn'
import {hasGitIdentity, readGitIdentity} from '../lib/git-identity'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'

const COMMIT_SUBJECT_LIMIT = 72

export function firstCommitSubject(
  projectName: string,
  templateName?: string
): string {
  const withTemplate = templateName
    ? `Create ${projectName} from the ${templateName} template`
    : ''
  if (withTemplate && withTemplate.length <= COMMIT_SUBJECT_LIMIT) {
    return withTemplate
  }

  const bare = `Create ${projectName}`
  return bare.length <= COMMIT_SUBJECT_LIMIT ? bare : 'Initial commit'
}

interface GitStepResult {
  ok: boolean
  reason?: string
}

async function runGit(
  args: string[],
  projectPath: string
): Promise<GitStepResult> {
  const stdio =
    process.env.EXTENSION_ENV === 'development' ? 'inherit' : 'ignore'
  const child = spawn('git', args, {
    stdio,
    cwd: projectPath,
    env: {...process.env, GIT_TERMINAL_PROMPT: '0'}
  })

  return await new Promise<GitStepResult>((resolve) => {
    child.on('close', (code) => {
      if (code === 0) return resolve({ok: true})
      resolve({ok: false, reason: `git ${args[0]} exited with ${code}`})
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      const reason =
        error?.code === 'ENOENT'
          ? 'git not found'
          : String(error?.message || error)
      resolve({ok: false, reason})
    })
  })
}

async function hasCommittedHistory(projectPath: string): Promise<boolean> {
  const inside = await runGit(
    ['rev-parse', '--is-inside-work-tree'],
    projectPath
  )
  if (!inside.ok) return false
  const head = await runGit(['rev-parse', '--verify', 'HEAD'], projectPath)
  return head.ok
}

/* @invariant An initialized repository with nothing committed records nothing:
 * the provenance file, the manifest, and every generated file stay untracked,
 * so the first `git status` reads as if the person wrote the scaffold by hand.
 * The commit is what makes the scaffold a baseline, which is why this step runs
 * after every file exists, .gitignore included. */
export async function initializeGitRepository(
  projectPath: string,
  projectName: string,
  templateName: string | undefined,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  if (isDebug()) logger.log(messages.initializingGitForRepository(projectName))

  // A repository that already has history is someone's branch: git init
  // succeeds inside it and a blanket add + commit would land a commit the
  // owner never wrote. Leave the scaffold uncommitted for them to review.
  if (await hasCommittedHistory(projectPath)) {
    logger.log(messages.existingRepositoryKept(projectName))
    return
  }

  const init = await runGit(['init', '--quiet'], projectPath)
  if (!init.ok) {
    logger.log(messages.initializingGitSkipped(projectName, init.reason || ''))
    return
  }

  const identity = readGitIdentity(projectPath)
  if (!hasGitIdentity(identity)) {
    logger.log(messages.firstCommitSkipped(projectName, 'no git user identity'))
    return
  }

  const staged = await runGit(['add', '--all'], projectPath)
  if (!staged.ok) {
    logger.log(messages.firstCommitSkipped(projectName, staged.reason || ''))
    return
  }

  const committed = await runGit(
    [
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--no-verify',
      '--message',
      firstCommitSubject(projectName, templateName)
    ],
    projectPath
  )

  if (!committed.ok) {
    logger.log(messages.firstCommitSkipped(projectName, committed.reason || ''))
  }
}
