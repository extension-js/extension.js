// ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs/promises'
import * as path from 'path'
import * as messages from '../lib/messages'

const globalDependencies = ['', '# dependencies', 'node_modules']
const globalTesting = ['', '# testing', 'coverage']
const globalProduction = ['', '# production', 'dist']
const globalMisc = ['', '# misc', '.DS_Store']
const envFiles = [
  '',
  '# local env files',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local'
]
const debugFiles = [
  '',
  '# debug files',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*'
]

const globalLines = [
  '# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.',
  ...globalDependencies,
  ...globalTesting,
  ...globalProduction,
  ...globalMisc,
  ...envFiles,
  ...debugFiles
]

export async function writeGitignore(projectPath: string) {
  const gitIgnorePath = path.join(projectPath, '.gitignore')
  const paths = new Set<string>()
  let currentContents = ''

  currentContents = await fs.readFile(gitIgnorePath, 'utf8').catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }

    console.error(err)
    throw err
  })

  for (const rawLine of currentContents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) {
      continue
    }
    paths.add(line)
  }

  const linesToAdd = globalLines.filter((line) => !paths.has(line))

  // Remove any trailing empty strings to prevent adding extra newlines
  while (linesToAdd[linesToAdd.length - 1] === '') {
    linesToAdd.pop()
  }

  if (linesToAdd.length === 0) {
    return
  }

  console.log(messages.writingGitIgnore())

  const shouldPrefixWithNewline =
    currentContents.length > 0 && !currentContents.endsWith('\n')
  const contentToAppend = `${shouldPrefixWithNewline ? '\n' : ''}${linesToAdd.join('\n')}`

  // Append the missing lines while preserving final newline behavior.
  await fs.appendFile(gitIgnorePath, contentToAppend).catch((err) => {
    console.error(err)
    throw err
  })
}
