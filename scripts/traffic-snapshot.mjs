import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const DAY_MS = 864e5
const SIBLING_PACKAGES = [
  'extension-create',
  'extension-develop',
  'extension-install'
]
const REFERENCE_PACKAGE = 'react'

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)

// npm reports 0 for whole days on every package and never backfills them,
// so a 0 is a missing day, never a real count at this volume.
export function correctDownloads(days, referenceDays = []) {
  const referenceZero = new Set(
    referenceDays.filter((d) => d.downloads === 0).map((d) => d.day)
  )
  const counted = days.filter((d) => d.downloads > 0)
  const raw = days.reduce((sum, d) => sum + d.downloads, 0)
  const zeroDays = days.filter((d) => d.downloads === 0).map((d) => d.day)

  return {
    zeroDays,
    outageDays: zeroDays.filter((day) => referenceZero.has(day)),
    daysCounted: counted.length,
    raw,
    corrected:
      counted.length === 0 ? null : Math.round((raw / counted.length) * 7)
  }
}

export function summarizePackage(days28, referenceDays28 = []) {
  const days7 = days28.slice(-7)
  const week = correctDownloads(days7, referenceDays28.slice(-7))
  const month = correctDownloads(days28, referenceDays28)

  return {
    zero_days: week.zeroDays,
    days_counted: week.daysCounted,
    week_raw: week.raw,
    week_corrected: week.corrected,
    '28d_raw': month.raw,
    '28d_corrected':
      month.daysCounted === 0
        ? null
        : Math.round((month.raw / month.daysCounted) * 28),
    outage_days: week.outageDays
  }
}

const gh = (apiPath) => {
  try {
    return JSON.parse(
      execFileSync('gh', ['api', apiPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    )
  } catch (error) {
    const text = String(error.stdout || '') + String(error.stderr || '')
    // The default Actions token cannot read traffic endpoints (403)
    if (/403|Resource not accessible/.test(text)) return null

    throw error
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// api.npmjs.org answers "error code: 1015" when called in a burst
async function npmRange(pkg, from, to) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(
      `https://api.npmjs.org/downloads/range/${from}:${to}/${pkg}`
    )
    const text = await response.text()

    try {
      return JSON.parse(text).downloads || []
    } catch {
      await sleep(5000 * (attempt + 1))
    }
  }

  throw new Error(`npm range for ${pkg} kept failing`)
}

async function main() {
  const repo = process.env.REPO || 'extension-js/extension.js'
  const pkg = process.env.NPM_PACKAGE || 'extension'
  const out = process.env.OUT || 'traffic.ndjson'
  const dryRun = process.env.DRY_RUN === '1'
  const pause = Number(process.env.NPM_PAUSE_MS ?? 3000)

  const now = Date.now()
  const today = isoDay(now)
  const yesterday = isoDay(now - DAY_MS)
  const since14 = isoDay(now - 14 * DAY_MS)
  const since28 = isoDay(now - 28 * DAY_MS)

  const views = gh(`repos/${repo}/traffic/views`)
  const clones = gh(`repos/${repo}/traffic/clones`)
  const referrers = gh(`repos/${repo}/traffic/popular/referrers`)
  const paths = gh(`repos/${repo}/traffic/popular/paths`)
  const meta = gh(`repos/${repo}`)

  const npm = await npmRange(pkg, since14, today)
  await sleep(pause)
  const reference28 = await npmRange(REFERENCE_PACKAGE, since28, yesterday)
  await sleep(pause)
  const own28 = await npmRange(pkg, since28, yesterday)
  const own = summarizePackage(own28, reference28)

  const packages = {}

  for (const sibling of SIBLING_PACKAGES) {
    await sleep(pause)
    packages[sibling] = summarizePackage(
      await npmRange(sibling, since28, yesterday),
      reference28
    )
  }

  const traffic = Boolean(views && clones && referrers && paths)
  const line = {
    date: today,
    github: {
      views: traffic
        ? views.views.map((v) => [v.timestamp.slice(0, 10), v.count, v.uniques])
        : null,
      clones: traffic
        ? clones.clones.map((v) => [
            v.timestamp.slice(0, 10),
            v.count,
            v.uniques
          ])
        : null,
      referrers: traffic
        ? referrers.map((r) => [r.referrer, r.count, r.uniques])
        : null,
      paths: traffic ? paths.map((p) => [p.path, p.count, p.uniques]) : null,
      stars: meta ? meta.stargazers_count : null,
      forks: meta ? meta.forks_count : null
    },
    npm: npm.map((d) => [d.day, d.downloads]),
    npm_window: [own28.at(-7)?.day ?? null, yesterday],
    npm_zero_days: own.zero_days,
    npm_outage: own.outage_days,
    npm_days_counted: own.days_counted,
    npm_week_raw: own.week_raw,
    npm_week_corrected: own.week_corrected,
    npm_28d_raw: own['28d_raw'],
    npm_28d_corrected: own['28d_corrected'],
    npm_packages: packages
  }

  if (dryRun) {
    console.log(JSON.stringify(line))

    return
  }

  fs.appendFileSync(out, `${JSON.stringify(line)}\n`)
  const trafficNote = traffic
    ? `${views.views.length} view days, ${referrers.length} referrers`
    : 'no traffic access (token lacks push rights, set TRAFFIC_TOKEN)'
  console.log(
    `appended ${today}: ${trafficNote}, npm week ${own.week_raw} raw / ${own.week_corrected} corrected, ${line.github.stars} stars`
  )
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
