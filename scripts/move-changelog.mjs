#!/usr/bin/env node

import fs from 'node:fs'
import {pathToFileURL} from 'node:url'

const HEADER = '## Unreleased'

export function moveChangelog(text, version, date, releaseNotes) {
  if (!version) throw new Error('move-changelog: version is required')
  if (!date) throw new Error('move-changelog: date is required')

  const notes = (releaseNotes || '').trim() || '- No changes listed.'
  const withHeader = text.includes(HEADER) ? text : `${HEADER}\n\n${text}`

  const start = withHeader.indexOf(HEADER)

  if (start === -1) {
    throw new Error('CHANGELOG.md missing ## Unreleased section')
  }

  const afterHeader = start + HEADER.length
  let nextHeader = withHeader.indexOf('\n## ', afterHeader)
  if (nextHeader === -1) nextHeader = withHeader.length

  const before = withHeader.slice(0, start)
  const after = withHeader.slice(nextHeader).replace(/^\s+/, '')

  const updated = [
    before,
    `${HEADER}\n\n`,
    `## ${version} (${date})\n\n`,
    notes,
    '\n\n',
    after
  ].join('')

  // Fail loudly rather than silently shipping a changelog with no version
  // heading, which is exactly how the previous breakage went unnoticed.
  if (!updated.includes(`## ${version} (`)) {
    throw new Error(`move-changelog: failed to write heading for ${version}`)
  }

  return updated
}

export function formatReleaseDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(now)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const version = process.env.VERSION
  const path = process.env.CHANGELOG_PATH || 'CHANGELOG.md'
  const text = fs.readFileSync(path, 'utf8')
  const updated = moveChangelog(
    text,
    version,
    formatReleaseDate(),
    process.env.RELEASE_NOTES
  )
  fs.writeFileSync(path, updated)
  console.log(`move-changelog: wrote ## ${version} section to ${path}`)
}
