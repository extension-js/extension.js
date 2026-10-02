//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'

const intro =
  '# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.'

// Every .env file is ignored by default, since any of them can hold a secret.
// Templates stay tracked: the .example names, and the .env.<browser> files a
// template ships (listed by the caller, re-allowed one by one).
const ENV_RULES = ['.env*', '!.env.example', '!.env.*.example']

const groups = [
  {header: '# dependencies', rules: ['node_modules']},
  {header: '# testing', rules: ['coverage']},
  {header: '# production', rules: ['dist']},
  {header: '# misc', rules: ['.DS_Store']},
  {header: '# Extension.js local session state', rules: ['.extension-js']},
  {header: '# local env files', rules: ENV_RULES},
  {
    header: '# debug files',
    rules: ['npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*']
  }
]

// A .env.<name> a template ships. Plain .env, the .local variants and the
// .example templates are never in this set: the first two stay ignored and
// the last is already allowed.
function isTemplateEnvFileName(name: string): boolean {
  if (!name.startsWith('.env.')) return false

  return !name.endsWith('.local') && !name.endsWith('.example')
}

function comparable(line: string): string {
  const trimmed = line.trim()

  return trimmed.startsWith('#') ? trimmed.toLowerCase() : trimmed
}

// The .env.<name> files the template put in the project: every one on disk
// that the owner did not have before the scaffold ran.
async function templateEnvFilesIn(
  projectPath: string,
  ownedEntries: readonly string[]
): Promise<string[]> {
  const owned = new Set(ownedEntries)
  const entries = await fs.readdir(projectPath).catch(() => [] as string[])

  return entries
    .filter((name) => isTemplateEnvFileName(name) && !owned.has(name))
    .sort()
}

export async function writeGitignore(
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void},
  options: {ownedEntries?: readonly string[]} = {}
) {
  const gitIgnorePath = path.join(projectPath, '.gitignore')
  const templateEnvFiles = await templateEnvFilesIn(
    projectPath,
    options.ownedEntries ?? []
  )

  const currentContents = await fs
    .readFile(gitIgnorePath, 'utf8')
    .catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return ''
      }

      logger.error(err)

      throw err
    })

  const present = new Set(
    currentContents.split(/\r?\n/).map(comparable).filter(Boolean)
  )

  const blocks = groups.flatMap(({header, rules}) => {
    const allowed =
      rules === ENV_RULES ? templateEnvFiles.map((name) => `!${name}`) : []
    const missing = [...rules, ...allowed].filter((rule) => !present.has(rule))

    return missing.length > 0 ? [[header, ...missing].join('\n')] : []
  })

  if (blocks.length === 0) {
    return
  }

  if (!present.has(comparable(intro))) {
    blocks.unshift(intro)
  }

  if (isDebug()) logger.log(messages.writingGitIgnore())

  const existing = currentContents.trimEnd()
  const contents = `${existing ? `${existing}\n\n` : ''}${blocks.join('\n\n')}\n`

  await fs.writeFile(gitIgnorePath, contents).catch((err) => {
    logger.error(err)

    throw err
  })
}
