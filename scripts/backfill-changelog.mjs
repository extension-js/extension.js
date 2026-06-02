#!/usr/bin/env node

import {execFileSync} from 'child_process'
import {readFileSync, writeFileSync} from 'fs'

import {generate} from './generate-release-notes.mjs'

const WRITE = process.argv.includes('--write')
const CHANGELOG = 'CHANGELOG.md'
const floorArgIndex = process.argv.indexOf('--floor')
const FLOOR_VERSION =
  floorArgIndex >= 0 ? process.argv[floorArgIndex + 1] : '3.8.2'

function git(args) {
  return execFileSync('git', args, {encoding: 'utf8'}).trim()
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function semverGt(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return false
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i]
  }
  return false
}

function formatDate(iso) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(iso))
}

function getStableReleases() {
  const log = git([
    'log',
    'HEAD',
    '-E',
    '--grep=^release\\(stable\\): v[0-9]',
    '--format=%H%x09%cI%x09%s'
  ])
  const seen = new Set()
  const releases = []
  for (const line of log.split('\n').filter(Boolean)) {
    const [sha, date, subject] = line.split('\t')
    const version = (subject.match(/v(\d+\.\d+\.\d+)$/) || [])[1]
    if (!version || seen.has(version)) continue
    seen.add(version)
    releases.push({sha, date, version})
  }
  return releases
}

function main() {
  const releases = getStableReleases()
  if (releases.length === 0) {
    throw new Error('No release(stable) commits found on HEAD.')
  }

  const toBuild = releases
    .filter((r) => semverGt(r.version, FLOOR_VERSION))
    .sort((a, b) => (semverGt(a.version, b.version) ? -1 : 1))

  const sections = toBuild.map((release) => {
    const notes = generate({
      currentVersion: release.version,
      toRef: release.sha,
      format: 'markdown',
      highlightsFile: undefined
    })
    return `## ${release.version} (${formatDate(release.date)})\n\n${notes}\n`
  })

  // Unreleased = genuine delta since the most recent release boundary.
  const unreleased = generate({
    toRef: 'HEAD',
    format: 'markdown',
    highlightsFile: undefined
  })
  const unreleasedBlock =
    unreleased.trim() === '- No changes listed.'
      ? '## Unreleased\n'
      : `## Unreleased\n\n${unreleased}\n`

  // Keep the existing hand-written tail from the floor version downward.
  const text = readFileSync(CHANGELOG, 'utf8')
  const floorHeader = `## ${FLOOR_VERSION}`
  const floorIndex = text.indexOf(floorHeader)
  if (floorIndex === -1) {
    throw new Error(`CHANGELOG.md missing "${floorHeader}" anchor section.`)
  }
  const tail = text.slice(floorIndex).trimEnd()

  const rebuilt =
    [
      '# Changelog',
      '',
      unreleasedBlock.trimEnd(),
      '',
      ...sections.map((s) => s.trimEnd()),
      '',
      tail
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'

  if (WRITE) {
    writeFileSync(CHANGELOG, rebuilt)
    process.stderr.write(
      `Rebuilt ${CHANGELOG}: ${toBuild.length} version sections above v${FLOOR_VERSION}.\n`
    )
  } else {
    process.stdout.write(rebuilt)
    process.stderr.write(
      `\n[dry run] Would rebuild ${toBuild.length} sections above v${FLOOR_VERSION}. Pass --write to apply.\n`
    )
  }
}

main()
