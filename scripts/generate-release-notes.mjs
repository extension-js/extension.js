#!/usr/bin/env node

import {execFileSync} from 'child_process'

function getArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function git(args) {
  return execFileSync('git', args, {encoding: 'utf8'}).trim()
}

function getLastStableTag(currentVersion, toRef = 'HEAD') {
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'])
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .filter((tag) => tag !== `v${currentVersion}`)

  if (tags.length === 0) return ''

  const bestTag = tags[0]

  // Check if the tag is an actual ancestor of the target ref.
  // When history has been rebased after tagging, the tag points to an
  // orphaned commit and the range "tag..ref" explodes to the full diff
  // between two divergent lineages. In that case, find the matching
  // release commit in the current lineage by its commit message instead.
  try {
    git(['merge-base', '--is-ancestor', bestTag, toRef])
    return bestTag
  } catch {
    const version = bestTag.replace(/^v/, '')
    const sha = git([
      'log',
      toRef,
      '--format=%H',
      '--grep',
      `release(stable): v${version}`,
      '-1'
    ])
    return sha || bestTag
  }
}

function getCommits(range) {
  const output = git([
    'log',
    range,
    '--no-merges',
    '--invert-grep',
    '--grep=chore(release)',
    '--grep=release(',
    '--pretty=format:%H\t%h\t%s'
  ])

  if (!output) return []

  return output
    .split('\n')
    .map((line) => {
      const [full, short, ...subjectParts] = line.split('\t')
      return {
        full,
        short,
        subject: subjectParts.join('\t').trim()
      }
    })
    .filter((commit) => commit.short && commit.subject)
}

function matchesAny(subject, patterns) {
  return patterns.some((pattern) => pattern.test(subject))
}

function formatRefs(commits) {
  return `(${commits.map((commit) => commit.short).join(', ')})`
}

const IGNORED_PATTERNS = [
  // ── Release / publish pipeline ────────────────────────────────────────
  /^Fix publish workflow/i,
  /^Fix release pipeline/i,
  /^Fix next\/canary publish workflows$/i,
  /^Resolve release notes range/i,
  /^Exclude chore\(release\)\/release\(\) from changelog/i,

  // ── CI / Actions infrastructure ───────────────────────────────────────
  /^Use pnpm\/action-setup v\d+/i,
  /^Add privacy-safe workflow telemetry/i,
  /^Optimize .+ workflows/i,
  /^Add .+ CI .+ sandbox/i,
  /^Fix stale .+ path in .+ (smoke|script)/i,

  // ── Build-time type-declaration fixes (no runtime impact) ─────────────
  /^Add missing @types\//i,

  // ── Test-only additions ───────────────────────────────────────────────
  /^Add .+ spec tests/i,

  // ── Internal package restructuring (public package names unchanged) ───
  /^Combine CLI \+ browser/i,
  /^Extract programs\//i,
  /^Rename programs\//i,

  // ── Dependency bumps (Dependabot, manual audit) ───────────────────────
  /^Bump .+ from .+ to /i,

  // ── Lockfile / infrastructure-only maintenance ────────────────────────
  /^Update pnpm lockfile$/i,
  /^Remove build-dependencies\.json/i
]

const GROUPS = [
  {
    summary:
      'Improve browser launch, reload, and teardown reliability across Chromium and Firefox.',
    patterns: [
      /Harden browser CDP\/RDP reliability/i,
      /Fix CDP race condition/i,
      /fix signal race/i
    ]
  },
  {
    summary:
      'Restructure the `start` command to run build then preview for faster iteration.',
    patterns: [
      /Remove extensionStart from develop/i,
      /Orchestrate start command/i,
      /Add lightweight preview entry/i
    ]
  },
  {
    summary:
      'Make `extension-create` and `extension-develop` programmatically accessible with injectable loggers, structured results, and a BuildEmitter event API.',
    patterns: [/Make extensionCreate API/i, /Add BuildEmitter event API/i]
  }
]

function generateNotes(commits) {
  const used = new Set()
  const lines = []

  for (const group of GROUPS) {
    const matched = commits.filter((commit) => {
      if (used.has(commit.full)) return false
      return matchesAny(commit.subject, group.patterns)
    })

    if (matched.length === 0) continue

    matched.forEach((commit) => used.add(commit.full))
    lines.push(`- ${group.summary} ${formatRefs(matched)}`)
  }

  const leftovers = commits.filter((commit) => {
    if (used.has(commit.full)) return false
    return !matchesAny(commit.subject, IGNORED_PATTERNS)
  })

  leftovers.forEach((commit) => {
    lines.push(`- ${commit.subject} (${commit.short})`)
  })

  return lines.length > 0 ? lines.join('\n') : '- No changes listed.'
}

const currentVersion = getArg('--current-version') || ''
const fromTag = getArg('--from')
const toRef = getArg('--to') || 'HEAD'
const lastTag = fromTag || getLastStableTag(currentVersion, toRef)
const range = lastTag ? `${lastTag}..${toRef}` : toRef
const commits = getCommits(range)

process.stdout.write(generateNotes(commits))
