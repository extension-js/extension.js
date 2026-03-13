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

function getLastStableTag(currentVersion) {
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'])
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .filter((tag) => tag !== `v${currentVersion}`)

  return tags[0] || ''
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
  /^Fix publish workflow$/i,
  /^Fix publish workflow release notes and action runtimes$/i,
  /^Fix release pipeline error$/i,
  /^Fix next\/canary publish workflows$/i,
  /^Add privacy-safe workflow telemetry profiles$/i,
  /^Exclude chore\(release\)\/release\(\) from changelog, add retroactive clean script$/i
]

const GROUPS = [
  {
    summary:
      'Improve build output and warning summaries so extension size and performance issues are easier to understand.',
    patterns: [
      /Enhance output data view for performance hints/i,
      /Richer build output/i,
      /Fix branding warning spacing/i,
      /Fix CLI banner consistency across dev, preview, and start/i,
      /Fix empty line position on CLI ready status banner/i,
      /Format warning details with paragraphs and consistent styling/i
    ]
  },
  {
    summary:
      'Fix manifest emission, persistence, and reload flows to make development rebuilds more reliable.',
    patterns: [
      /Format Chromium hard reload controller calls/i,
      /Fix dev-server manifest disk write guard on CI/i,
      /Fix Chromium manifest reload recovery/i,
      /Fix manifest pipeline ordering and disk persistence/i,
      /Fix manifest\.json writes across plugin passes/i,
      /Fix startup recompiles when special folders are missing/i,
      /Guard Chromium reloads when developer mode is disabled/i
    ]
  },
  {
    summary:
      'Improve content script development behavior, including bridge resolution and clearer default export warnings.',
    patterns: [
      /content_script bridge resolution in development/i,
      /content_script warn/i,
      /export default.*content_script warn/i
    ]
  },
  {
    summary:
      'Improve Chromium and Windows stability across teardown and follow-up test scenarios.',
    patterns: [
      /Skip Windows EBUSY teardown after timed dev tests/i,
      /Wait for Windows CLI process cleanup before teardown/i,
      /Fix Windows follow-up test regressions/i
    ]
  },
  {
    summary:
      'Stabilize optional dependency installation during build and nested workspace environment resolution.',
    patterns: [
      /Stabilize optional dependency installs during build/i,
      /Fix monorepo root env fallback for nested extension builds/i
    ]
  },
  {
    summary:
      'Reduce noisy ecosystem warnings and refresh the lockfile security resolution.',
    patterns: [
      /Ignore Vue compiler-sfc critical dependency warning/i,
      /Fix devalue security resolution in pnpm lockfile/i
    ]
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
const lastTag = fromTag || getLastStableTag(currentVersion)
const range = lastTag ? `${lastTag}..${toRef}` : toRef
const commits = getCommits(range)

process.stdout.write(generateNotes(commits))
