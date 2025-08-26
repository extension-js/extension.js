import * as path from 'path'
import {describe, it, expect} from 'vitest'
import {spawn} from 'child_process'

// Smoke test a GitHub remote preview in web-only mode (no package.json)
describe('GitHub remote (web-only) preview', () => {
  it('previews a subpath repo without package.json', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..')
    const cli = path.join(repoRoot, 'programs', 'cli', 'dist', 'cli.js')
    const url =
      'https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder'

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          'preview',
          url,
          '--browser',
          'chrome',
          '--profile',
          'false',
          '--starting-url',
          'https://example.com'
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            EXTENSION_ENV: 'development'
          }
        }
      )
      let out = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out running remote preview'))
      }, 90000)
      child.stdout.on('data', (d) => {
        out += String(d)
        if (/Previewing|Extension\.js|running in production/i.test(out)) {
          clearTimeout(timeout)
          try {
            child.kill('SIGTERM')
          } catch {}
          setTimeout(() => resolve(), 200)
        }
      })
      child.on('error', reject)
    })
  }, 120000)
})
