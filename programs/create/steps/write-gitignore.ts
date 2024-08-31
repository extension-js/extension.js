import fs from 'fs/promises'
import * as messages from '../lib/messages'

const globalDependencies = ['# dependencies', '/node_modules']
const globalTesting = ['# testing', '/coverage']
const globalProduction = ['# production', '/dist']
const globalMisc = ['# misc', '.DS_Store', '.env.local', '.env.development.local',
  '.env.test.local', '.env.production.local', 'npm-debug.log*', 'yarn-debug.log*', 'yarn-error.log*', 'extension.d.ts']
const globalLockFiles = ['# lock files', 'yarn.lock', 'package-lock.json']

const globalLines = [
  ...globalDependencies,
  ...globalTesting,
  ...globalProduction,
  ...globalMisc,
  ...globalLockFiles
]

export async function writeGitignore(projectPath: string) {
  const gitIgnorePath = projectPath + '/.gitignore'

  const fileHandle = await fs.open(gitIgnorePath, 'a+').catch((err) => {
    console.error(err)
    process.exit(1)
  })

  const paths = new Set<String>()
  // autoClose is required, otherwise the stream will close the file
  // and we'll be unable to append to it
  //
  // Note: while readLines works for this use-case, care needs to be had
  // if adding more contents to the loop, basically, the loop should just
  // consume the data from readLines and nothing else
  //
  // Reference: https://stackoverflow.com/a/70616910
  for await (let line of fileHandle.readLines({autoClose: false})) {
    line = line.trim()
    if (line.length === 0) {
      continue
    }
    paths.add(line)
  }

  const linesToAdd = globalLines.filter((line) => !paths.has(line))

  console.log(messages.writingGitIgnore())

  await fileHandle
    .appendFile(linesToAdd.join('\n'), {flush: true})
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
