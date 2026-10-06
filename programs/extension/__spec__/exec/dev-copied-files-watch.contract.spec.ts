import {spawn} from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

const PNG_V1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
const PNG_V2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhQGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

interface Frame {
  status: string
}

interface CopiedFile {
  source: string
  emitted: string
  next: string | Buffer
  token: string | Buffer
}

const COPIED: CopiedFile[] = [
  {
    source: 'icons/icon16.png',
    emitted: 'icons/icon16.png',
    next: PNG_V2,
    token: PNG_V2
  },
  {
    source: 'assets/war.txt',
    emitted: 'assets/war.txt',
    next: 'copied-watch-war-v2\n',
    token: 'copied-watch-war-v2'
  },
  {
    source: 'rules/ruleset.json',
    emitted: 'declarative_net_request/r1.json',
    next: JSON.stringify([
      {
        id: 1,
        priority: 1,
        action: {type: 'block'},
        condition: {urlFilter: 'copied-watch-rule-v2'}
      }
    ]),
    token: 'copied-watch-rule-v2'
  },
  {
    source: '_locales/en/notes.txt',
    emitted: '_locales/en/notes.txt',
    next: 'copied-watch-notes-v2\n',
    token: 'copied-watch-notes-v2'
  },
  {
    source: 'public/data.txt',
    emitted: 'data.txt',
    next: 'copied-watch-public-v2\n',
    token: 'copied-watch-public-v2'
  }
]

function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    EXTENSION_ENV: 'test',
    EXTENSION_TELEMETRY: '0'
  }
  delete env.VITEST
  delete env.VITEST_WORKER_ID

  return env
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function parseFrames(stdout: string): Frame[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Frame)
}

function writeProject(projectDir: string) {
  for (const dir of [
    'icons',
    'assets',
    'rules',
    '_locales/en',
    'public',
    'pages',
    'scripts'
  ]) {
    mkdirSync(join(projectDir, dir), {recursive: true})
  }

  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Copied Files Watch',
      version: '1.0.0',
      default_locale: 'en',
      icons: {16: 'icons/icon16.png'},
      action: {default_popup: 'pages/popup.html'},
      background: {service_worker: 'background.js'},
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['scripts/content.js']}
      ],
      web_accessible_resources: [
        {resources: ['assets/war.txt'], matches: ['https://example.com/*']}
      ],
      declarative_net_request: {
        rule_resources: [{id: 'r1', enabled: true, path: 'rules/ruleset.json'}]
      },
      permissions: ['declarativeNetRequest']
    })
  )

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'copied-files-watch', private: true})
  )

  writeFileSync(join(projectDir, 'background.js'), 'console.log("bg")\n')
  writeFileSync(join(projectDir, 'scripts/content.js'), 'console.log("cs")\n')
  writeFileSync(
    join(projectDir, 'pages/popup.html'),
    '<html><body>popup</body></html>\n'
  )

  writeFileSync(join(projectDir, 'icons/icon16.png'), PNG_V1)
  writeFileSync(join(projectDir, 'assets/war.txt'), 'copied-watch-war-v1\n')
  writeFileSync(join(projectDir, 'rules/ruleset.json'), '[]\n')
  writeFileSync(
    join(projectDir, '_locales/en/messages.json'),
    JSON.stringify({name: {message: 'Copied Files Watch'}})
  )

  writeFileSync(
    join(projectDir, '_locales/en/notes.txt'),
    'copied-watch-notes-v1\n'
  )

  writeFileSync(join(projectDir, 'public/data.txt'), 'copied-watch-public-v1\n')
}

function emittedCarries(distDir: string, file: CopiedFile): boolean {
  try {
    const emitted = readFileSync(join(distDir, file.emitted))

    return Buffer.isBuffer(file.token)
      ? emitted.equals(file.token)
      : emitted.toString('utf8').includes(file.token)
  } catch {
    return false
  }
}

describe.skipIf(process.platform === 'win32')(
  'a dev session with every special folder present',
  () => {
    const leftovers: string[] = []

    afterEach(() => {
      for (const dir of leftovers.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    it('recompiles and recopies each file the build copies without a module reference', async () => {
      const work = mkdtempSync(join(tmpdir(), 'extjs-copied-watch-'))
      leftovers.push(work)
      const projectDir = join(work, 'project')
      writeProject(projectDir)
      const distDir = join(projectDir, 'dist', 'chrome')

      const child = spawn(
        process.execPath,
        [
          cliBin,
          'dev',
          projectDir,
          '--browser',
          'chrome',
          '--no-browser',
          '--output',
          'json'
        ],
        {cwd: cliRoot, stdio: 'pipe', env: cliEnv()}
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
      child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
      const closed = new Promise<number | null>((resolvePromise) =>
        child.once('close', (code) => resolvePromise(code))
      )
      const recompiles = () =>
        parseFrames(stdout).filter((frame) => frame.status === 'recompiled')
          .length

      const deadline = Date.now() + 60_000

      while (
        Date.now() < deadline &&
        !parseFrames(stdout).some((frame) => frame.status === 'ready')
      ) {
        await sleep(250)
      }

      expect(
        parseFrames(stdout).map((frame) => frame.status),
        stderr
      ).toContain('ready')

      const recopied: string[] = []

      for (const file of COPIED) {
        const seen = recompiles()
        writeFileSync(join(projectDir, file.source), file.next)
        const editDeadline = Date.now() + 15_000

        while (
          Date.now() < editDeadline &&
          !(recompiles() > seen && emittedCarries(distDir, file))
        ) {
          await sleep(250)
        }

        if (emittedCarries(distDir, file)) recopied.push(file.source)
      }

      child.kill('SIGINT')
      await Promise.race([
        closed,
        sleep(15_000).then(() => child.kill('SIGKILL'))
      ])

      expect(recopied, stderr).toEqual(COPIED.map((file) => file.source))
    }, 150_000)
  }
)
