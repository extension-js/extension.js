import assert from 'node:assert/strict'
import {test} from 'node:test'
import {correctDownloads, summarizePackage} from '../traffic-snapshot.mjs'

const series = (start, counts) =>
  counts.map((downloads, index) => {
    const day = new Date(Date.parse(start) + index * 864e5)
      .toISOString()
      .slice(0, 10)
    return {day, downloads}
  })

test('a zero day is dropped and the week is scaled from the counted days', () => {
  const days = series('2026-10-12', [1505, 0, 0, 0, 1347, 859, 1006])
  const result = correctDownloads(days)

  assert.deepEqual(result.zeroDays, ['2026-10-13', '2026-10-14', '2026-10-15'])
  assert.equal(result.daysCounted, 4)
  assert.equal(result.raw, 4717)
  assert.equal(result.corrected, Math.round((4717 / 4) * 7))
})

test('a full week is left as is', () => {
  const days = series('2026-09-28', [864, 776, 1190, 2371, 1288, 2019, 1088])

  assert.equal(correctDownloads(days).corrected, 9596)
})

test('a zero day that the reference package shares is an npm outage', () => {
  const days = series('2026-10-12', [1505, 0, 1200, 0, 1347, 859, 1006])
  const reference = series('2026-10-12', [9, 0, 9, 9, 9, 9, 9])

  assert.deepEqual(correctDownloads(days, reference).outageDays, ['2026-10-13'])
})

test('a window with no counted day has no corrected figure', () => {
  assert.equal(correctDownloads(series('2026-10-12', [0, 0])).corrected, null)
})

test('the package summary scales the week and the 28 day window', () => {
  const counts = Array.from({length: 28}, (_, i) => (i % 7 === 3 ? 0 : 1000))
  const summary = summarizePackage(series('2026-09-21', counts))

  assert.equal(summary.days_counted, 6)
  assert.equal(summary.week_raw, 6000)
  assert.equal(summary.week_corrected, 7000)
  assert.equal(summary['28d_raw'], 24000)
  assert.equal(summary['28d_corrected'], 28000)
})
