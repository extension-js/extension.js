import {execSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../..')

// The publish platform's host may appear in a README, which is prose about
// sponsorship, and nowhere else: every address the CLI prints or scaffolds
// comes from EXTENSION_DEV_DOCS_URL and EXTENSION_DEV_API_URL.
const PLATFORM_HOST = ['extension', 'dev'].join('.')
const SOURCE = /\.(ts|tsx|js|mjs|cjs|json|md|snap)$/

function trackedProgramFiles(): string[] {
  return execSync(
    'git ls-files --cached --others --exclude-standard programs',
    {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024
    }
  )
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter((file) => SOURCE.test(file))
    .filter((file) => !file.includes('/node_modules/'))
    .filter((file) => !file.includes('/dist/'))
    .filter((file) => !/(^|\/)README\.md$/.test(file))
}

describe('platform links', () => {
  it('hardcodes the platform host in no program source outside a README', () => {
    const offenders = trackedProgramFiles().filter((file) =>
      readFileSync(resolve(REPO, file), 'utf8').includes(PLATFORM_HOST)
    )
    expect(offenders).toEqual([])
  })
})
