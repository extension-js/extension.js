import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {framesIn, startCli} from '../helpers/run-cli'

// A companion named in the config that is not on disk is left out of the
// session. Dev says so once, the way it was typed and where it was declared.
function createFixture(): string {
  const projectDir = realpathSync(
    mkdtempSync(join(tmpdir(), 'extjs-dev-missing-companion-'))
  )

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'missing-companion', private: true, version: '1.0.0'})
  )

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Missing Companion',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  writeFileSync(join(projectDir, 'background.js'), "console.log('one')\n")
  writeFileSync(
    join(projectDir, 'extension.config.mjs'),
    "export default {extensions: ['./extensions/not-there']}\n"
  )

  return projectDir
}

type SessionEvent = {type: string}

function eventsOf(projectDir: string): SessionEvent[] {
  const file = join(
    projectDir,
    'dist',
    'extension-js',
    'chromium',
    'events.ndjson'
  )

  if (!existsSync(file)) return []

  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionEvent)
}

function compiles(projectDir: string): number {
  return eventsOf(projectDir).filter((event) =>
    event.type.startsWith('compile_')
  ).length
}

function waitForCompile(
  projectDir: string,
  seen: number,
  output: () => string
) {
  return new Promise<void>((resolvePromise, reject) => {
    const startedAt = Date.now()

    const poll = () => {
      if (compiles(projectDir) > seen) return resolvePromise()

      if (Date.now() - startedAt > 90000) {
        return reject(new Error(`no compile observed, output:\n${output()}`))
      }

      setTimeout(poll, 50)
    }

    poll()
  })
}

function startDev(projectDir: string, extra: string[] = []) {
  return startCli([
    'dev',
    projectDir,
    '--no-browser',
    '--browser=chromium',
    ...extra
  ])
}

// Two compiles, so a line said again on a rebuild would show up twice.
async function compileTwice(projectDir: string, output: () => string) {
  await waitForCompile(projectDir, 0, output)

  const seen = compiles(projectDir)

  writeFileSync(join(projectDir, 'background.js'), "console.log('two')\n")
  await waitForCompile(projectDir, seen, output)
}

describe('dev --no-browser with a named companion that is not there', () => {
  it('warns once with the entry as typed and the layer that named it', async () => {
    const projectDir = createFixture()
    const session = startDev(projectDir)

    try {
      await compileTwice(projectDir, () => session.read().output)

      expect(
        session
          .read()
          .output.split('\n')
          .filter((line) => /^(ENTRY|DECLARED IN|NOT FOUND) /.test(line))
      ).toEqual([
        'ENTRY ./extensions/not-there',
        'DECLARED IN extensions in extension.config.js',
        `NOT FOUND ${join(projectDir, 'extensions', 'not-there', 'manifest.json')}`
      ])
    } finally {
      await session.stop('SIGTERM')
      rmSync(projectDir, {recursive: true, force: true})
    }
  }, 120000)

  it('names the flag when the entry was typed on the command line', async () => {
    const projectDir = createFixture()
    const session = startDev(projectDir, ['--extensions=./extensions/typed'])

    try {
      await waitForCompile(projectDir, 0, () => session.read().output)

      expect(
        session
          .read()
          .output.split('\n')
          .filter((line) => /^(ENTRY|DECLARED IN) /.test(line))
      ).toEqual([
        'ENTRY ./extensions/typed',
        'DECLARED IN the --extensions flag'
      ])
    } finally {
      await session.stop('SIGTERM')
      rmSync(projectDir, {recursive: true, force: true})
    }
  }, 120000)

  it('carries the code once on the machine frames', async () => {
    const projectDir = createFixture()
    const session = startDev(projectDir, ['--output=json'])

    try {
      await compileTwice(projectDir, () => session.read().output)

      const coded = framesIn<{warnings?: string[]}>(session.read().stdout)
        .flatMap((frame) => frame.warnings ?? [])
        .filter((warning) => warning.startsWith('W_COMPANION_EXTENSION_PATH'))

      expect(coded).toHaveLength(1)
      expect(coded[0]).toContain('ENTRY ./extensions/not-there')
      expect(coded[0]).toContain(
        'DECLARED IN extensions in extension.config.js'
      )
    } finally {
      await session.stop('SIGTERM')
      rmSync(projectDir, {recursive: true, force: true})
    }
  }, 120000)
})
