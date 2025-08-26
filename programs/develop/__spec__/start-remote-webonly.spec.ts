import * as path from 'path'
import {describe, it} from 'vitest'
import {spawn} from 'child_process'

// Smoke test: start on a GitHub subpath repo with no package.json (web-only)
describe('extension start (remote web-only)', () => {
  it('builds silently and previews from dist/<browser>', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..')
    const cli = path.join(repoRoot, 'programs', 'cli', 'dist', 'cli.js')
    const url =
      'https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.page-redder'

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          'start',
          url,
          '--browser',
          'chrome',
          '--profile',
          'false',
          '--open',
          'false'
        ],
        {
          cwd: repoRoot,
          env: {...process.env, EXTENSION_ENV: 'development'}
        }
      )
      let out = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out running start on remote repo'))
      }, 120000)
      child.stdout.on('data', (d) => {
        out += String(d)
        if (
          /No errors or warnings|ready for deployment|running in production/i.test(
            out
          )
        ) {
          clearTimeout(timeout)
          try {
            child.kill('SIGTERM')
          } catch {}
          setTimeout(() => resolve(), 200)
        }
      })
      child.on('error', reject)
    })
  }, 150000)
})
