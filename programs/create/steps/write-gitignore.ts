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

// The .env, .env.local and *.local files hold secrets. The .env.<browser> and
// .env.<mode> files are project config the env templates ship and commit.
const groups = [
  {header: '# dependencies', rules: ['node_modules']},
  {header: '# testing', rules: ['coverage']},
  {header: '# production', rules: ['dist']},
  {header: '# misc', rules: ['.DS_Store']},
  {header: '# Extension.js local session state', rules: ['.extension-js']},
  {header: '# local env files', rules: ['.env', '.env.local', '.env.*.local']},
  {
    header: '# debug files',
    rules: ['npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*']
  }
]

function comparable(line: string): string {
  const trimmed = line.trim()

  return trimmed.startsWith('#') ? trimmed.toLowerCase() : trimmed
}

export async function writeGitignore(
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  const gitIgnorePath = path.join(projectPath, '.gitignore')

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
    const missing = rules.filter((rule) => !present.has(rule))

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
