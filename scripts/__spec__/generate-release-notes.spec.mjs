import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

import {
  categorize,
  readHighlights,
  formatMarkdown,
  formatDiscord,
  buildTweet,
  findAnchor,
  resolveRange
} from '../generate-release-notes.mjs'

const commit = (subject, short = 'abc1234') => ({
  full: `${short}0000000000000000000000000000000000`,
  short,
  subject
})

// ── categorize ────────────────────────────────────────────────────────────────

test('categorize routes commits into features / fixes / other', () => {
  const buckets = categorize([
    commit('Add the extension logs command'),
    commit('Surface real CDP port into ready.json'),
    commit('Fix the three CI failures'),
    commit('Bump ws to ^8.20.1 to patch GHSA-58qx-3vcg-4xpx'),
    commit('Raise perf-budget defaults to 512/512/1024 KiB'),
    commit('Document publish as a thin wrapper')
  ])

  assert.deepEqual(
    buckets.features.map((c) => c.subject),
    ['Add the extension logs command', 'Surface real CDP port into ready.json']
  )
  assert.deepEqual(
    buckets.fixes.map((c) => c.subject),
    [
      'Fix the three CI failures',
      'Bump ws to ^8.20.1 to patch GHSA-58qx-3vcg-4xpx'
    ]
  )
  assert.deepEqual(
    buckets.other.map((c) => c.subject),
    [
      'Raise perf-budget defaults to 512/512/1024 KiB',
      'Document publish as a thin wrapper'
    ]
  )
})

test('categorize drops ignored noise (dep bumps, lockfile churn)', () => {
  const buckets = categorize([
    commit('Bump turbo from 2.8.12 to 2.9.14'),
    commit('Refresh pnpm-lock.yaml for the ws control-bridge dependency'),
    commit('Bump Extension.js'),
    commit('Add a real feature')
  ])
  assert.equal(buckets.features.length, 1)
  assert.equal(buckets.fixes.length, 0)
  assert.equal(buckets.other.length, 0)
})

// ── readHighlights ──────────────────────────────────────────────────────────────

test('readHighlights parses bullets and ignores HTML-comment instructions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-'))
  const file = path.join(dir, 'RELEASE_HIGHLIGHTS.md')
  writeFileSync(
    file,
    [
      '<!--',
      '  instructions',
      '  - **example** — commented bullet must be ignored',
      '-->',
      '',
      '## Highlights',
      '',
      '- **`extension publish`** — share a build via URL',
      '- Safari (alpha) support'
    ].join('\n')
  )
  assert.deepEqual(readHighlights(file), [
    '**`extension publish`** — share a build via URL',
    'Safari (alpha) support'
  ])
  rmSync(dir, {recursive: true, force: true})
})

test('readHighlights returns [] for the empty template and missing file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hl-'))
  const file = path.join(dir, 'RELEASE_HIGHLIGHTS.md')
  writeFileSync(file, '<!-- instructions -->\n\n## Highlights\n')
  assert.deepEqual(readHighlights(file), [])
  assert.deepEqual(readHighlights(path.join(dir, 'nope.md')), [])
  rmSync(dir, {recursive: true, force: true})
})

// ── formatters ───────────────────────────────────────────────────────────────

test('formatMarkdown leads with highlights and folds other changes', () => {
  const buckets = categorize([
    commit('Add a feature', 'feat123'),
    commit('Fix a bug', 'fix4567'),
    commit('Document a thing', 'doc8901')
  ])
  const md = formatMarkdown({
    highlights: ['**Big thing** — does X'],
    buckets,
    repoUrl: 'https://example.com/repo'
  })
  assert.match(md, /^- \*\*Big thing\*\* — does X/)
  assert.match(md, /### 🚀 Features/)
  assert.match(md, /### 🐛 Fixes/)
  assert.match(md, /<details>\n<summary>🧹 Other changes \(1\)<\/summary>/)
  assert.match(md, /\(\[feat123\]\(https:\/\/example\.com\/repo\/commit\//)
})

test('formatMarkdown returns a placeholder when nothing qualifies', () => {
  assert.equal(
    formatMarkdown({
      highlights: [],
      buckets: {features: [], fixes: [], other: []}
    }),
    '- No changes listed.'
  )
})

test('formatDiscord uses highlights when present, else leads with features', () => {
  const buckets = categorize([
    commit('Add feature one'),
    commit('Add feature two'),
    commit('Add feature three'),
    commit('Add feature four'),
    commit('Fix something')
  ])

  const withHl = formatDiscord({
    highlights: ['Curated headline'],
    buckets,
    notesUrl: 'https://example.com/notes'
  })
  assert.match(withHl, /^- Curated headline/)
  assert.match(withHl, /🚀 4 features · 🐛 1 fixes/)
  assert.match(
    withHl,
    /\[Full release notes\]\(https:\/\/example\.com\/notes\)/
  )

  const noHl = formatDiscord({highlights: [], buckets, notesUrl: ''})
  // Falls back to the first three features, not all four.
  assert.match(noHl, /- Add feature one/)
  assert.match(noHl, /- Add feature three/)
  assert.doesNotMatch(noHl, /- Add feature four/)
})

test('buildTweet strips markdown, caps length, and appends the url', () => {
  const tweet = buildTweet({
    version: '3.19.0',
    highlights: [
      '**`extension publish`** — share a [build](https://x) via URL'
    ],
    buckets: {features: [], fixes: [], other: []},
    notesUrl: 'https://example.com/notes'
  })
  assert.match(tweet, /Extension\.js v3\.19\.0 is out!/)
  assert.doesNotMatch(tweet, /[`*]/)
  assert.doesNotMatch(tweet, /\]\(/) // no markdown link syntax
  assert.match(tweet, /https:\/\/example\.com\/notes$/)
})

// ── anchor / range (temp git repo) ──────────────────────────────────────────────

test('findAnchor picks the most recent on-branch release boundary, excluding the current version', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gen-notes-git-'))
  const run = (...args) =>
    execFileSync('git', args, {cwd: dir, encoding: 'utf8'}).trim()
  const commitEmpty = (msg) =>
    execFileSync('git', ['commit', '--allow-empty', '-m', msg], {cwd: dir})

  run('init', '-q')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'Test')
  run('config', 'commit.gpgsign', 'false')

  commitEmpty('Initial work')
  commitEmpty('release(stable): v3.17.0')
  commitEmpty('Add a feature after 3.17')
  commitEmpty('release(stable): v3.18.0')
  commitEmpty('chore(release): move changelog to v3.18.0')
  commitEmpty('Work toward 3.19')

  const prevCwd = process.cwd()
  try {
    process.chdir(dir)
    // Releasing 3.19.0: anchor must be the most recent 3.18.0 boundary,
    // never the 3.19.0 release itself.
    const anchor = findAnchor('HEAD', '3.19.0')
    const subject = execFileSync('git', ['log', '-1', '--format=%s', anchor], {
      cwd: dir,
      encoding: 'utf8'
    }).trim()
    assert.equal(subject, 'chore(release): move changelog to v3.18.0')

    const range = resolveRange('3.19.0', undefined, 'HEAD')
    assert.match(range, /\.\.HEAD$/)
  } finally {
    process.chdir(prevCwd)
    rmSync(dir, {recursive: true, force: true})
  }
})

test('findAnchor excludes the current version when its boundary already exists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gen-notes-git-'))
  const run = (...args) =>
    execFileSync('git', args, {cwd: dir, encoding: 'utf8'}).trim()

  run('init', '-q')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'Test')
  run('config', 'commit.gpgsign', 'false')
  execFileSync(
    'git',
    ['commit', '--allow-empty', '-m', 'release(stable): v3.17.0'],
    {cwd: dir}
  )
  execFileSync('git', ['commit', '--allow-empty', '-m', 'feature'], {cwd: dir})
  execFileSync(
    'git',
    ['commit', '--allow-empty', '-m', 'release(stable): v3.18.0'],
    {cwd: dir}
  )

  const prevCwd = process.cwd()
  try {
    process.chdir(dir)
    // Backfilling 3.18.0 (its boundary is HEAD): anchor must skip to 3.17.0.
    const anchor = findAnchor('HEAD', '3.18.0')
    const subject = execFileSync('git', ['log', '-1', '--format=%s', anchor], {
      cwd: dir,
      encoding: 'utf8'
    }).trim()
    assert.equal(subject, 'release(stable): v3.17.0')
  } finally {
    process.chdir(prevCwd)
    rmSync(dir, {recursive: true, force: true})
  }
})
