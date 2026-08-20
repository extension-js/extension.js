import {spawn} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  const projectDir = mkdtempSync(join(tmpdir(), 'extjs-golden-boot-'))
  mkdirSync(join(projectDir, 'content'), {recursive: true})
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({name: 'golden-boot', private: true, version: '1.0.0'})
  )
  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Golden Boot',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    })
  )
  writeFileSync(
    join(projectDir, 'content', 'scripts.js'),
    "console.log('golden boot fixture')\n"
  )
  return projectDir
}

function captureDevBoot(projectDir: string) {
  return new Promise<string>((resolvePromise, reject) => {
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
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(output)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      if (!settled) {
        settled = true
        reject(new Error(`dev boot timed out, output so far:\n${output}`))
      }
    }, 90000)
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output.includes('Watching for file changes.')) {
        setTimeout(() => {
          child.kill('SIGTERM')
          setTimeout(finish, 1000)
        }, 250)
      }
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.on('close', finish)
    child.on('error', (error) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(error)
      }
    })
  })
}

describe('dev --no-browser boot transcript', () => {
  it('prints compiled, then the card, then the ready line, in that order', async () => {
    const projectDir = createFixture()
    try {
      const output = await captureDevBoot(projectDir)
      const lines = output.split('\n')

      const compileIndex = lines.findIndex((line) =>
        /^⏵⏵⏵ \[\d{2}:\d{2}:\d{2}\] Golden Boot compiled in \d+ ms\.$/.test(
          line
        )
      )
      expect(compileIndex, `no compile line in:\n${output}`).toBeGreaterThan(-1)

      expect(lines[compileIndex + 1]).toBe(' ')

      const headIndex = compileIndex + 2
      expect(lines[headIndex]).toMatch(/^ 🧩 Extension\.js/)

      expect(lines[headIndex + 1]).toMatch(
        /^ {4}Browser {8}Chromium \(no-browser mode\)$/
      )
      expect(lines[headIndex + 2]).toMatch(
        /^ {4}Extension {6}Golden Boot 1\.0\.0$/
      )
      // Three rows and no more: MAX_CARD_ROWS caps every card, so this one
      // keeps Browser, Extension and Run ID. Output lost the slot on purpose,
      // because the previewing/serving line above the card already names the
      // directory, while the run id is this card's join key into ready.json
      // and is asserted by the preview specs too.
      expect(lines[headIndex + 3]).toMatch(/^ {4}Run ID {9}\S/)
      expect(lines[headIndex + 4]).toBe(' ')
      expect(lines[headIndex + 5]).toBe(
        '⏵⏵⏵ Extension ready for development. Watching for file changes.'
      )
    } finally {
      rmSync(projectDir, {recursive: true, force: true})
    }
  }, 120000)
})
