#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

const DEFAULT_REPO_URL = 'https://github.com/extension-js/extension.js'
const DEFAULT_HIGHLIGHTS_FILE = 'RELEASE_HIGHLIGHTS.md'

function getArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function git(args) {
  return execFileSync('git', args, {encoding: 'utf8'}).trim()
}

function gitOrEmpty(args) {
  try {
    return git(args)
  } catch {
    return ''
  }
}

const RELEASE_BOUNDARY_GREP = [
  '--grep=^release\\((stable|next)\\): v[0-9]',
  '--grep=^chore\\(release\\): move changelog to v[0-9]'
]

function findAnchor(toRef, currentVersion) {
  const log = gitOrEmpty([
    'log',
    toRef,
    '-E',
    ...RELEASE_BOUNDARY_GREP,
    '--format=%H%x09%s',
    '-n',
    '50'
  ])
  if (!log) return ''

  const currentTag = currentVersion ? `v${currentVersion}` : ''
  for (const line of log.split('\n')) {
    const [sha, subject = ''] = line.split('\t')
    if (!sha) continue
    if (currentTag && subject.includes(`${currentTag} `)) continue
    if (currentTag && subject.endsWith(currentTag)) continue

    return sha
  }

  return ''
}

function resolveRange(currentVersion, fromRef, toRef) {
  if (fromRef) return `${fromRef}..${toRef}`
  const anchor = findAnchor(toRef, currentVersion)
  return anchor ? `${anchor}..${toRef}` : toRef
}

// ── Commit collection ─────────────────────────────────────────────────────────

function getCommits(range) {
  const output = gitOrEmpty([
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
      return {full, short, subject: subjectParts.join('\t').trim()}
    })
    .filter((commit) => commit.short && commit.subject)
}

function matchesAny(subject, patterns) {
  return patterns.some((pattern) => pattern.test(subject))
}

const IGNORED_PATTERNS = [
  /^Bump .+ from .+ to /i, // Dependabot range bumps
  /^Bump Extension\.js$/i,
  /^Update pnpm[- ]lock/i,
  /^Refresh pnpm-lock/i,
  /^Remove build-dependencies\.json/i,
  /^Use pnpm\/action-setup/i,
  /^Add privacy-safe workflow telemetry/i,
  /^Add missing @types\//i,
  /^Combine CLI \+ browser/i,
  /^Extract programs\//i,
  /^Rename programs\//i
]

// Order matters: a commit lands in the first category whose patterns match.
const CATEGORIES = [
  {
    key: 'features',
    title: 'Features',
    patterns: [
      /^Add\b/i,
      /^Introduce\b/i,
      /^Support\b/i,
      /^Implement\b/i,
      /^Enable\b/i,
      /^Bundle\b/i,
      /^Expose\b/i,
      /^Allow\b/i,
      /^Surface\b/i,
      /^Forward\b/i,
      /^Inspect\b/i,
      /^Enhance\b/i
    ]
  },
  {
    key: 'fixes',
    title: 'Fixes',
    patterns: [
      /^Fix\b/i,
      /^Resolve\b/i,
      /^Patch\b/i,
      /^Restore\b/i,
      /^Repair\b/i,
      /^Correct\b/i,
      /^Prevent\b/i,
      /^Guard\b/i,
      /^Avoid\b/i,
      /^Stop\b/i,
      /^Harden\b/i,
      /^Ensure\b/i,
      /^Sweep\b/i,
      /^Gate\b/i,
      /to patch GHSA/i,
      /to clear .*advisor/i
    ]
  }
]

const OTHER_TITLE = 'Other changes'

function categorize(commits) {
  const buckets = {features: [], fixes: [], other: []}
  for (const commit of commits) {
    if (matchesAny(commit.subject, IGNORED_PATTERNS)) continue
    const category = CATEGORIES.find((group) =>
      matchesAny(commit.subject, group.patterns)
    )
    buckets[category ? category.key : 'other'].push(commit)
  }
  return buckets
}

function readHighlights(file) {
  if (!file || !existsSync(file)) return []

  const raw = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const lines = raw.split('\n')
  const start = lines.findIndex((line) => /^##\s+Highlights\s*$/i.test(line))

  if (start === -1) return []

  const highlights = []

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^##\s+/.test(line)) break

    const match = line.match(/^\s*[-*]\s+(.*\S)\s*$/)
    if (match) highlights.push(match[1].trim())
  }

  return highlights
}

function bullet(commit, repoUrl) {
  const link = repoUrl
    ? `([${commit.short}](${repoUrl}/commit/${commit.full}))`
    : `(${commit.short})`
  return `- ${commit.subject} ${link}`
}

function formatMarkdown({highlights, buckets, repoUrl}) {
  const sections = []

  if (highlights.length > 0) {
    sections.push(highlights.map((h) => `- ${h}`).join('\n'))
  }

  for (const group of CATEGORIES) {
    const commits = buckets[group.key]
    if (commits.length === 0) continue
    sections.push(
      `### ${group.title}\n\n` +
        commits.map((commit) => bullet(commit, repoUrl)).join('\n')
    )
  }

  if (buckets.other.length > 0) {
    const body = buckets.other
      .map((commit) => bullet(commit, repoUrl))
      .join('\n')
    sections.push(
      `<details>\n<summary>${OTHER_TITLE} (${buckets.other.length})</summary>\n\n${body}\n</details>`
    )
  }

  return sections.length > 0 ? sections.join('\n\n') : '- No changes listed.'
}

function formatDiscord({highlights, buckets, notesUrl}) {
  const parts = []

  if (highlights.length > 0) {
    parts.push(highlights.map((h) => `- ${h}`).join('\n'))
  } else {
    // No curated highlights: lead with up to 3 features so the ping still says
    // something concrete instead of just counts.
    const lead = buckets.features.slice(0, 3)
    if (lead.length > 0) {
      parts.push(lead.map((commit) => `- ${commit.subject}`).join('\n'))
    }
  }

  const summary = [
    buckets.features.length ? `${buckets.features.length} features` : '',
    buckets.fixes.length ? `${buckets.fixes.length} fixes` : '',
    buckets.other.length ? `${buckets.other.length} other` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  if (summary) parts.push(summary)

  if (notesUrl) parts.push(`[Full release notes](${notesUrl})`)

  return parts.length > 0 ? parts.join('\n\n') : 'No changes listed.'
}

function buildTweet({version, highlights, buckets, notesUrl}) {
  const headline =
    highlights[0] ||
    buckets.features[0]?.subject ||
    buckets.fixes[0]?.subject ||
    'New release'
  // Strip markdown emphasis/links for plain-text platforms.
  const plain = headline
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim()
  const lead = `Extension.js v${version} is out!`
  const body = plain.length > 180 ? `${plain.slice(0, 177)}...` : plain
  const url = notesUrl ? `\n\n${notesUrl}` : ''
  return `${lead}\n\n${body}${url}`
}

export function generate({
  currentVersion = '',
  fromRef,
  toRef = 'HEAD',
  format = 'markdown',
  repoUrl = DEFAULT_REPO_URL,
  notesUrl,
  highlightsFile
} = {}) {
  const resolvedNotesUrl =
    notesUrl ||
    (currentVersion ? `${repoUrl}/releases/tag/v${currentVersion}` : '')
  const range = resolveRange(currentVersion, fromRef, toRef)
  const commits = getCommits(range)
  const buckets = categorize(commits)
  const highlights = readHighlights(highlightsFile)

  if (format === 'json') {
    return JSON.stringify(
      {
        version: currentVersion || null,
        range,
        notesUrl: resolvedNotesUrl || null,
        highlights,
        features: buckets.features.map((c) => c.subject),
        fixes: buckets.fixes.map((c) => c.subject),
        other: buckets.other.map((c) => c.subject),
        counts: {
          features: buckets.features.length,
          fixes: buckets.fixes.length,
          other: buckets.other.length
        },
        tweet: buildTweet({
          version: currentVersion,
          highlights,
          buckets,
          notesUrl: resolvedNotesUrl
        })
      },
      null,
      2
    )
  }
  if (format === 'discord') {
    return formatDiscord({highlights, buckets, notesUrl: resolvedNotesUrl})
  }
  if (format === 'tweet') {
    return buildTweet({
      version: currentVersion,
      highlights,
      buckets,
      notesUrl: resolvedNotesUrl
    })
  }
  return formatMarkdown({highlights, buckets, repoUrl})
}

function main() {
  const currentVersion = getArg('--current-version') || ''
  const highlightsFile =
    getArg('--highlights') ||
    (existsSync(DEFAULT_HIGHLIGHTS_FILE) ? DEFAULT_HIGHLIGHTS_FILE : undefined)
  process.stdout.write(
    generate({
      currentVersion,
      fromRef: getArg('--from'),
      toRef: getArg('--to') || 'HEAD',
      format: getArg('--format') || 'markdown',
      repoUrl: getArg('--repo-url') || DEFAULT_REPO_URL,
      notesUrl: getArg('--notes-url'),
      highlightsFile
    })
  )
}

export {
  findAnchor,
  resolveRange,
  getCommits,
  categorize,
  readHighlights,
  formatMarkdown,
  formatDiscord,
  buildTweet,
  IGNORED_PATTERNS,
  CATEGORIES
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
