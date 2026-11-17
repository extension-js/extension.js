//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn} from 'cross-spawn'
import {
  type GitIdentity,
  hasGitIdentity,
  readGitIdentity
} from '../lib/git-identity'
import type {SpawnProcess} from '../lib/install-runner'
import * as messages from '../lib/messages'
import {fmt, isDebug} from '../lib/messaging'

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

// How the step reaches git. A caller that must not spawn passes its own.
export interface GitStepOptions {
  spawn?: SpawnProcess
  readIdentity?: (cwd: string) => GitIdentity
}

// Git says why on a fatal: or error: line, around advice that is not the cause.
function gitFailureLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^hint:/i.test(line))

  return fmt.truncate(
    lines.find((line) => /^(?:fatal|error):/i.test(line)) ?? lines[0] ?? '',
    300
  )
}

async function runGit(
  args: string[],
  projectPath: string,
  spawnProcess: SpawnProcess,
  globalArgs: string[] = []
): Promise<GitStepResult> {
  const child = spawnProcess('git', [...globalArgs, ...args], {
    stdio:
      process.env.EXTENSION_ENV === 'development'
        ? 'inherit'
        : ['ignore', 'ignore', 'pipe'],
    cwd: projectPath,
    env: {...process.env, GIT_TERMINAL_PROMPT: '0'}
  })
  let stderr = ''

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
  }

  return await new Promise<GitStepResult>((resolve) => {
    child.on('close', (code) => {
      if (code === 0) return resolve({ok: true})

      const exit = `git ${args[0]} exited with ${code}`
      const line = gitFailureLine(stderr)

      resolve({ok: false, reason: line ? `${exit}: ${line}` : exit})
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

async function hasCommittedHistory(
  projectPath: string,
  spawnProcess: SpawnProcess
): Promise<boolean> {
  const inside = await runGit(
    ['rev-parse', '--is-inside-work-tree'],
    projectPath,
    spawnProcess
  )
  if (!inside.ok) return false

  const head = await runGit(
    ['rev-parse', '--verify', 'HEAD'],
    projectPath,
    spawnProcess
  )

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
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void},
  {
    spawn: spawnProcess = spawn,
    readIdentity = readGitIdentity
  }: GitStepOptions = {}
) {
  if (isDebug()) logger.log(messages.initializingGitForRepository(projectName))

  // A repository that already has history is someone's branch: git init
  // succeeds inside it and a blanket add + commit would land a commit the
  // owner never wrote. Leave the scaffold uncommitted for them to review.
  if (await hasCommittedHistory(projectPath, spawnProcess)) {
    logger.log(messages.existingRepositoryKept(projectName))

    return
  }

  const init = await runGit(['init', '--quiet'], projectPath, spawnProcess)

  if (!init.ok) {
    logger.log(messages.initializingGitSkipped(projectName, init.reason || ''))

    return
  }

  const identity = readIdentity(projectPath)

  if (!hasGitIdentity(identity)) {
    logger.log(messages.firstCommitSkipped(projectName, 'no git user identity'))

    return
  }

  const staged = await runGit(['add', '--all'], projectPath, spawnProcess)

  if (!staged.ok) {
    logger.log(messages.firstCommitSkipped(projectName, staged.reason || ''))

    return
  }

  const committed = await runGit(
    [
      'commit',
      '--quiet',
      '--no-verify',
      '--message',
      firstCommitSubject(projectName, templateName)
    ],
    projectPath,
    spawnProcess,
    ['-c', 'commit.gpgsign=false']
  )

  if (!committed.ok) {
    logger.log(messages.firstCommitSkipped(projectName, committed.reason || ''))
  }
}
