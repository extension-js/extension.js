import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import {staleOverlayCaches} from '../prune-codeql-overlay-caches.mjs'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

const PREFIX = 'codeql-overlay-base-database-1-9af1d65f3980e190-'

function entry(id, rest, createdAt) {
  return {id, key: `${PREFIX}${rest}`, createdAt}
}

test('keeps the newest overlay base per language and CodeQL version', () => {
  const sha = (c) => c.repeat(40)
  const list = [
    entry(1, `javascript-2.27.4-${sha('a')}-100-1`, '2026-11-19T19:04:46Z'),
    entry(2, `javascript-2.27.4-${sha('b')}-101-1`, '2026-11-19T22:17:36Z'),
    entry(3, `javascript-2.27.4-${sha('c')}-102-2`, '2026-11-19T20:24:26Z'),
    entry(4, `javascript-2.27.3-${sha('d')}-90-1`, '2026-11-18T10:00:00Z'),
    entry(5, `actions-2.27.4-${sha('e')}-101-1`, '2026-11-19T22:17:40Z'),
    {id: 6, key: 'node-cache-Linux-x64-pnpm-abc', createdAt: '2026-11-19'}
  ]

  assert.deepEqual(
    staleOverlayCaches(list)
      .map((cache) => cache.id)
      .sort(),
    [1, 3]
  )
})

test('deletes every stale overlay base through gh and nothing else', {
  skip: process.platform === 'win32'
}, () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-prune-'))
  const calls = path.join(scratch, 'calls.log')
  const listing = JSON.stringify([
    entry(
      11,
      `javascript-2.27.4-${'a'.repeat(40)}-1-1`,
      '2026-11-19T01:00:00Z'
    ),
    entry(12, `javascript-2.27.4-${'b'.repeat(40)}-2-1`, '2026-11-19T02:00:00Z')
  ])
  fs.writeFileSync(path.join(scratch, 'listing.json'), listing)
  fs.writeFileSync(
    path.join(scratch, 'gh'),
    `#!/usr/bin/env bash\necho "$*" >> "${calls}"\nif [[ "$1 $2" == "cache list" ]]; then cat "${path.join(scratch, 'listing.json')}"; fi\n`,
    {mode: 0o755}
  )

  try {
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'prune-codeql-overlay-caches.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${scratch}${path.delimiter}${process.env.PATH}`,
          GITHUB_REPOSITORY: 'extension-js/extension.js'
        }
      }
    )

    assert.equal(result.status, 0, result.stderr)
    const lines = fs.readFileSync(calls, 'utf8').trim().split('\n')
    assert.match(lines[0], /^cache list .*--key codeql-overlay-base-database-/)
    assert.match(lines[0], /--ref refs\/heads\/main/)
    assert.deepEqual(lines.slice(1), [
      'cache delete 11 --repo extension-js/extension.js'
    ])
  } finally {
    fs.rmSync(scratch, {recursive: true, force: true})
  }
})
