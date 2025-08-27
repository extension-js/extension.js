import * as path from 'path'
import {describe, it} from 'vitest'
import {spawn} from 'child_process'

// Smoke test: start on a GitHub subpath repo with no package.json (web-only)
// NOTE: This test can be flaky on CI due to remote network and browser startup timing. Skipping for stability.
describe.skip('extension start (remote web-only)', () => {
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
      let err = ''
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out running start on remote repo'))
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
      child.stderr?.on('data', (d) => {
        err += String(d)
      })
      child.on('error', (e) => {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(e)
      })
    })
  }, 120000)
})
