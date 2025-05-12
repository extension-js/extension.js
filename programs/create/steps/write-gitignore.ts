import fs from 'fs/promises'
import path from 'path'
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
const extensionJsFiles = ['', '# extension.js', 'extension-env.d.ts']

const globalLines = [
  '# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.',
  ...globalDependencies,
  ...globalTesting,
  ...globalProduction,
  ...globalMisc,
  ...envFiles,
  ...debugFiles,
  ...extensionJsFiles
]

export async function writeGitignore(projectPath: string) {
  const gitIgnorePath = path.join(projectPath, '.gitignore')

  const fileHandle = await fs.open(gitIgnorePath, 'a+').catch((err) => {
    console.error(err)
    process.exit(1)
  })

  const paths = new Set<String>()

  for await (let line of fileHandle.readLines({autoClose: false})) {
    line = line.trim()
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

  console.log(messages.writingGitIgnore())

  // Append the lines without adding an extra newline at the end
  await fileHandle.appendFile(linesToAdd.join('\n')).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
