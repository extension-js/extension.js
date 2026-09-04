import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import * as messages from '../lib/messages'

const HERE = dirname(fileURLToPath(import.meta.url))

const DOCS_HOST = 'https://docs.platform.test'
const SHARE_DOCS_URL = `${DOCS_HOST}/share/unpublished-build-for-review?utm_source=cli-build`

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, '')
}

const ORIG = process.env.EXTENSION_DEV_DOCS_URL

beforeEach(() => {
  delete process.env.EXTENSION_DEV_DOCS_URL
})

afterEach(() => {
  if (ORIG === undefined) delete process.env.EXTENSION_DEV_DOCS_URL
  else process.env.EXTENSION_DEV_DOCS_URL = ORIG
})

describe('build share hint', () => {
  it('prints nothing when no platform docs host is configured', () => {
    expect(messages.buildShareHint()).toBe('')
  })

  it('prints nothing for a blank platform docs host', () => {
    process.env.EXTENSION_DEV_DOCS_URL = '   '
    expect(messages.buildShareHint()).toBe('')
  })

  it('names the share page under the configured docs host', () => {
    process.env.EXTENSION_DEV_DOCS_URL = DOCS_HOST
    expect(stripAnsi(messages.buildShareHint())).toContain(SHARE_DOCS_URL)
  })

  it('tolerates a trailing slash on the docs host', () => {
    process.env.EXTENSION_DEV_DOCS_URL = `${DOCS_HOST}/`
    expect(stripAnsi(messages.buildShareHint())).toContain(SHARE_DOCS_URL)
  })

  it('says what the reader gets, in the words someone searching would use', () => {
    process.env.EXTENSION_DEV_DOCS_URL = DOCS_HOST
    const line = stripAnsi(messages.buildShareHint())
    expect(line.toLowerCase()).toContain('review')
  })

  it('is printed on every successful build only when it has a line to print', () => {
    const source = readFileSync(resolve(HERE, '../command-build.ts'), 'utf8')
    expect(source).toContain('messages.buildShareHint()')
    expect(source).toContain('if (shareHint) humanLine(shareHint)')
  })

  it('carries the attribution that makes the click countable', () => {
    process.env.EXTENSION_DEV_DOCS_URL = DOCS_HOST
    expect(stripAnsi(messages.buildShareHint())).toContain(
      'utm_source=cli-build'
    )
  })

  it('hardcodes no platform address in the message catalog', () => {
    const source = readFileSync(resolve(HERE, '../lib/messages.ts'), 'utf8')
    expect(source).not.toMatch(/extension\.dev/)
  })
})
