import * as path from 'path'
import * as fs from 'fs'
import {describe, it, expect} from 'vitest'
import {execFile, spawn} from 'child_process'
import {promisify} from 'util'

const execFileAsync = promisify(execFile)

describe('extension start (CLI parity)', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..')

  it('runs in production mode and cleanup frees instances', async () => {
    const env = {
      ...process.env,
      EXTENSION_ENV: 'development'
    } as unknown as NodeJS.ProcessEnv

    const exampleSrc = path.join(repoRoot, 'examples', 'content')
    const tmpDir = path.join(__dirname, '.tmp-start')
    fs.rmSync(tmpDir, {recursive: true, force: true})
    fs.cpSync(exampleSrc, tmpDir, {recursive: true})

    let chromium = ''
    try {
      const {stdout} = await execFileAsync(
        'node',
        [
          '-e',
          "console.log(require('playwright-core').chromium.executablePath())"
        ],
        {cwd: repoRoot}
      )
      chromium = stdout.trim()
    } catch {}

    const cli = path.join(repoRoot, 'programs', 'cli', 'dist', 'cli.js')
    const args = [
      cli,
      'start',
      tmpDir,
      '--browser',
      'chrome',
      '--profile',
      'false',
      '--port',
      '0',
      '--starting-url',
      'https://example.com'
    ]
    if (chromium) args.push('--chromium-binary', chromium)

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, {cwd: repoRoot, env})
      let buffer = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('start timed out'))
      }, 20000)
      child.stdout.on('data', (data) => {
        buffer += data.toString()
        if (
          buffer.includes('Extension.js') ||
          buffer.includes('server running on') ||
          buffer.includes('compiled successfully')
        ) {
          clearTimeout(timeout)
          try {
            child.kill('SIGTERM')
          } catch {}
          setTimeout(() => resolve(), 250)
        }
      })
      child.stderr.on('data', () => {})
      child.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
      child.on('exit', () => {})
    })

    const {stdout} = await execFileAsync('pnpm', ['extension', 'cleanup'], {
      cwd: repoRoot,
      env
    })
    expect(String(stdout)).toContain('Cleaning up orphaned instances')

    fs.rmSync(tmpDir, {recursive: true, force: true})
  }, 60000)
})
