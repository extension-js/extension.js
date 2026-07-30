import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

import * as messages from '../lib/messages'

const HERE = dirname(fileURLToPath(import.meta.url))

const SHARE_DOCS_URL =
  'https://docs.extension.dev/share/unpublished-build-for-review?utm_source=cli-build'

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*m/g, '')
}

describe('build share hint', () => {
  it('names the share destination the docs site publishes', () => {
    expect(stripAnsi(messages.buildShareHint())).toContain(SHARE_DOCS_URL)
  })

  it('says what the reader gets, in the words someone searching would use', () => {
    const line = stripAnsi(messages.buildShareHint())
    expect(line.toLowerCase()).toContain('review')
    expect(line).not.toContain('@extension.dev/deploy')
  })

  it('is printed on every successful build', () => {
    const source = readFileSync(resolve(HERE, '../command-build.ts'), 'utf8')
    expect(source).toContain('messages.buildShareHint()')
  })

  it('carries the attribution that makes the click countable', () => {
    expect(stripAnsi(messages.buildShareHint())).toContain(
      'utm_source=cli-build'
    )
  })

  it('is the only docs.extension.dev address the build path prints', () => {
    const source = readFileSync(resolve(HERE, '../lib/messages.ts'), 'utf8')
    const addresses = source.match(/https:\/\/docs\.extension\.dev[^\s'"`)]*/g)
    expect(addresses).toEqual([SHARE_DOCS_URL])
  })
})
