import {spawn, spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

const BACKUP_SUBJECT = 'lint-staged automatic backup'
const BACKUP_REF_PREFIX = 'refs/lint-staged-backups'
const STALE_AFTER_MS = 60 * 60 * 1000

const require = createRequire(import.meta.url)
const lintStagedBin = path.join(
  path.dirname(require.resolve('lint-staged/package.json')),
  'bin',
  'lint-staged.js'
)

function git(args) {
  return spawnSync('git', args, {encoding: 'utf8'})
}

export function listBackups() {
  const result = git(['stash', 'list', '--format=%H %ct %gs'])

  if (result.status !== 0) return []

  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      const [hash, seconds, ...subject] = line.split(' ')

      return {
        index,
        hash,
        createdAtMs: Number(seconds) * 1000,
        subject: subject.join(' ')
      }
    })
    .filter((entry) => entry.subject.endsWith(BACKUP_SUBJECT))
}

// Every worktree shares one stash stack, so a backup left on it shifts the
// indices other sessions pop and drop by. A ref keeps it without the shift.
export function moveBackupOutOfStash(hash) {
  const entry = listBackups().find((backup) => backup.hash === hash)

  if (!entry) return null

  const ref = `${BACKUP_REF_PREFIX}/${hash.slice(0, 12)}`

  if (git(['update-ref', ref, hash]).status !== 0) return null

  if (
    git(['stash', 'drop', '--quiet', `stash@{${entry.index}}`]).status !== 0
  ) {
    return null
  }

  process.stderr.write(
    `lint-staged left a backup of your changes. It is kept at ${ref}, restore it with: git stash apply --index ${hash}\n`
  )

  return ref
}

export function moveStaleBackups(now = Date.now()) {
  for (const backup of listBackups()) {
    if (now - backup.createdAtMs >= STALE_AFTER_MS) {
      moveBackupOutOfStash(backup.hash)
    }
  }
}

async function main() {
  moveStaleBackups()

  const before = new Set(listBackups().map((backup) => backup.hash))
  const child = spawn(process.execPath, [lintStagedBin], {stdio: 'inherit'})

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => child.kill(signal))
  }

  const code = await new Promise((resolve) => {
    child.once('exit', (exitCode, signal) =>
      resolve(exitCode ?? (signal ? 1 : 0))
    )
  })

  for (const backup of listBackups()) {
    if (!before.has(backup.hash)) moveBackupOutOfStash(backup.hash)
  }

  process.exit(code)
}

if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).toString()
) {
  await main()
}
