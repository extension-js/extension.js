#!/usr/bin/env node
/**
 * Retroactively clean GitHub release bodies by removing release-machinery commit
 * lines: chore(release):... and release(...):...
 *
 * Usage: node scripts/clean-release-notes.mjs [--dry-run]
 * Requires: gh CLI (gh auth login) or run via .github/workflows/clean-release-notes.yml
 * (workflow has repo write access; local gh may need maintainer permissions)
 */

import {execSync} from 'child_process'
import {writeFileSync, unlinkSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'

const DRY_RUN = process.argv.includes('--dry-run')

/** Patterns for lines to remove from release notes (release machinery, not user-facing). */
const EXCLUDE_PATTERNS = [
  /^\s*-\s*chore\(release\):/,
  /^\s*-\s*release\([^)]*\):/
]

function cleanBody(body) {
  if (!body || typeof body !== 'string') return body
  const lines = body.split('\n')
  const filtered = lines.filter((line) => {
    return !EXCLUDE_PATTERNS.some((re) => re.test(line))
  })
  return filtered
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getReleases() {
  const out = execSync('gh release list --limit 500', {encoding: 'utf8'})
  return out
    .split('\n')
    .map((line) => {
      const match = line.match(/^[^\t]+\t[^\t]*\t(v[^\t]+)/)
      return match ? match[1] : null
    })
    .filter(Boolean)
}

function getReleaseBody(tag) {
  try {
    return execSync(`gh release view ${tag} --json body -q .body`, {
      encoding: 'utf8'
    })
  } catch {
    return null
  }
}

function updateReleaseNotes(tag, notes) {
  const tmp = join(
    tmpdir(),
    `release-notes-${tag.replace(/[^a-z0-9.-]/gi, '_')}.md`
  )
  writeFileSync(tmp, notes, 'utf8')
  try {
    execSync(`gh release edit ${tag} --notes-file ${tmp}`, {stdio: 'inherit'})
    return true
  } catch (err) {
    console.error(`  → failed: ${err.message || err}`)
    return false
  } finally {
    try {
      unlinkSync(tmp)
    } catch {}
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log(
    DRY_RUN
      ? '[DRY RUN] Would update the following releases:\n'
      : 'Cleaning release notes...\n'
  )
  const tags = getReleases()
  let updated = 0

  for (const tag of tags) {
    const original = getReleaseBody(tag)
    const cleaned = cleanBody(original)
    if (cleaned !== (original || '').trim()) {
      console.log(`${tag}: has lines to remove`)
      if (!DRY_RUN) {
        if (updateReleaseNotes(tag, cleaned || '- No changes listed.')) {
          console.log(`  → updated`)
          updated++
        }
        await sleep(500)
      }
    }
  }

  console.log(
    DRY_RUN
      ? `\nWould update releases. Run without --dry-run to apply.`
      : `\nUpdated ${updated} release(s).`
  )
}

main()
