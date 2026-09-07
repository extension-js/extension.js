// Weekly distribution snapshot: GitHub traffic (14-day retention upstream),
// npm daily downloads, and stars, appended as one NDJSON line per run.
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'

const repo = process.env.REPO || 'extension-js/extension.js'
const pkg = process.env.NPM_PACKAGE || 'extension'
const out = process.env.OUT || 'traffic.ndjson'
const gh = (path) =>
  JSON.parse(execFileSync('gh', ['api', path], {encoding: 'utf8'}))
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
const line = {
  date: today,
  github: {
    views: views.views.map((v) => [
      v.timestamp.slice(0, 10),
      v.count,
      v.uniques
    ]),
    clones: clones.clones.map((v) => [
      v.timestamp.slice(0, 10),
      v.count,
      v.uniques
    ]),
    referrers: referrers.map((r) => [r.referrer, r.count, r.uniques]),
    paths: paths.map((p) => [p.path, p.count, p.uniques]),
    stars: meta.stargazers_count,
    forks: meta.forks_count
  },
  npm: (npm.downloads || []).map((d) => [d.day, d.downloads])
}
fs.appendFileSync(out, JSON.stringify(line) + '\n')
console.log(
  `appended ${today}: ${line.github.views.length} view days, ${line.github.referrers.length} referrers, ${line.npm.length} npm days, ${line.github.stars} stars`
)
