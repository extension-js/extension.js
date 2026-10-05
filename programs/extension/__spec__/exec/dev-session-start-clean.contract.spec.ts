import {type ChildProcess, spawn} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')

function cliBin(): string {
  const cjs = join(cliRoot, 'dist', 'cli.cjs')
  if (existsSync(cjs)) return cjs

  return join(cliRoot, 'dist', 'cli.js')
}

function createFixture(): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-start-clean-'))
  mkdirSync(join(projectDir, 'public'), {recursive: true})
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'start-clean', private: true, version: '1.0.0'})
  )

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Start Clean',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  writeBackground(projectDir, "console.log('start clean fixture')\n")
  writeFileSync(join(projectDir, 'public', 'still-shipped.txt'), 'shipped')

  return projectDir
}

function writeBackground(projectDir: string, source: string) {
  writeFileSync(join(projectDir, 'background.js'), source)
}

function plant(file: string, text: string) {
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, text)

  return file
}

function eventsOf(projectDir: string) {
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
    .map((line) => JSON.parse(line) as {type: string})
}

function startDev(projectDir: string) {
  const child = spawn(
    process.execPath,
    [cliBin(), 'dev', projectDir, '--no-browser', '--browser=chromium'],
    {
      cwd: cliRoot,
      stdio: 'pipe',
      env: {...process.env, NO_COLOR: '1', EXTENSION_ENV: 'test'}
    }
  )
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  return {child, output: () => output}
}

function compileCount(projectDir: string) {
  return eventsOf(projectDir).filter(
    (event) =>
      event.type === 'compile_success' || event.type === 'compile_error'
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
      if (compileCount(projectDir) > seen) return resolvePromise()

      if (Date.now() - startedAt > 90000) {
        return reject(new Error(`no compile observed, output:\n${output()}`))
      }

      setTimeout(poll, 50)
    }

    poll()
  })
}

function stop(child: ChildProcess) {
  return new Promise<void>((resolvePromise) => {
    child.once('close', () => resolvePromise())
    child.kill('SIGTERM')
  })
}

describe('dev --no-browser at the start of a session', () => {
  it('drops what an earlier session left in the browser folder and nothing else', async () => {
    const projectDir = createFixture()
    const dist = join(projectDir, 'dist', 'chromium')
    const session = join(projectDir, 'dist', 'extension-js')
    const stale = plant(
      join(dist, 'deleted-between-sessions.txt'),
      'left by an earlier session'
    )
    const logs = plant(
      join(session, 'chromium', 'logs.1.ndjson'),
      '{"earlier":"session"}\n'
    )
    const profile = plant(
      join(session, 'profiles', 'chromium-profile', 'dev', 'Preferences'),
      '{}'
    )
    const otherBrowser = plant(
      join(projectDir, 'dist', 'firefox', 'manifest.json'),
      '{}'
    )
    const dev = startDev(projectDir)

    try {
      await waitForCompile(projectDir, 0, dev.output)

      expect({
        stale: existsSync(stale),
        manifest: existsSync(join(dist, 'manifest.json')),
        shipped: existsSync(join(dist, 'still-shipped.txt')),
        logs: readFileSync(logs, 'utf-8'),
        profile: existsSync(profile),
        otherBrowser: existsSync(otherBrowser)
      }).toEqual({
        stale: false,
        manifest: true,
        shipped: true,
        logs: '{"earlier":"session"}\n',
        profile: true,
        otherBrowser: true
      })
    } finally {
      await stop(dev.child)
      rmSync(projectDir, {recursive: true, force: true})
    }
  }, 120000)

  it('keeps the previous build while the first compile fails, then prunes once it passes', async () => {
    const projectDir = createFixture()
    const dist = join(projectDir, 'dist', 'chromium')
    const previousBuild = plant(
      join(dist, 'background', 'service_worker.js'),
      'the last good build'
    )
    const stale = plant(
      join(dist, 'deleted-between-sessions.txt'),
      'left by an earlier session'
    )
    writeBackground(projectDir, "console.log('broken'\n")
    const dev = startDev(projectDir)

    try {
      await waitForCompile(projectDir, 0, dev.output)

      expect(eventsOf(projectDir).at(-1)?.type).toBe('compile_error')
      expect(readFileSync(previousBuild, 'utf-8')).toBe('the last good build')
      expect(existsSync(stale)).toBe(true)

      writeBackground(projectDir, "console.log('start clean fixed')\n")
      await waitForCompile(projectDir, 1, dev.output)

      expect(eventsOf(projectDir).at(-1)?.type).toBe('compile_success')
      expect(readFileSync(previousBuild, 'utf-8')).toContain(
        'start clean fixed'
      )

      expect(existsSync(stale)).toBe(false)
    } finally {
      await stop(dev.child)
      rmSync(projectDir, {recursive: true, force: true})
    }
  }, 120000)
})
