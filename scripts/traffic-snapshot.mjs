// Weekly distribution snapshot: GitHub traffic (14-day retention upstream),
// npm daily downloads, and stars, appended as one NDJSON line per run.
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'

const repo = process.env.REPO || 'extension-js/extension.js'
const pkg = process.env.NPM_PACKAGE || 'extension'
const out = process.env.OUT || 'traffic.ndjson'

// The default Actions token cannot read traffic endpoints (403), so a run
// without a personal token still records npm and stars and says why.
const gh = (path) => {
  try {
    return JSON.parse(
      execFileSync('gh', ['api', path], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
    )
  } catch (error) {
    const text = String(error.stdout || '') + String(error.stderr || '')
    if (/403|Resource not accessible/.test(text)) return null
    throw error
  }
}

const today = new Date().toISOString().slice(0, 10)
const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)
const views = gh(`repos/${repo}/traffic/views`)
const clones = gh(`repos/${repo}/traffic/clones`)
const referrers = gh(`repos/${repo}/traffic/popular/referrers`)
const paths = gh(`repos/${repo}/traffic/popular/paths`)
const meta = gh(`repos/${repo}`)
const npm = await (
  await fetch(`https://api.npmjs.org/downloads/range/${since}:${today}/${pkg}`)
).json()

const traffic = Boolean(views && clones && referrers && paths)
const line = {
  date: today,
  github: {
    views: traffic
      ? views.views.map((v) => [v.timestamp.slice(0, 10), v.count, v.uniques])
      : null,
    clones: traffic
      ? clones.clones.map((v) => [v.timestamp.slice(0, 10), v.count, v.uniques])
      : null,
    referrers: traffic
      ? referrers.map((r) => [r.referrer, r.count, r.uniques])
      : null,
    paths: traffic ? paths.map((p) => [p.path, p.count, p.uniques]) : null,
    stars: meta ? meta.stargazers_count : null,
    forks: meta ? meta.forks_count : null
  },
  npm: (npm.downloads || []).map((d) => [d.day, d.downloads])
}
fs.appendFileSync(out, JSON.stringify(line) + '\n')
const trafficNote = traffic
  ? `${views.views.length} view days, ${referrers.length} referrers`
  : 'no traffic access (token lacks push rights, set TRAFFIC_TOKEN)'
console.log(
  `appended ${today}: ${trafficNote}, ${line.npm.length} npm days, ${line.github.stars} stars`
)
