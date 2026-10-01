// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export function judgeIdentityRun(rows, {allowSkips = false} = {}) {
  const failed = rows.filter((row) => row.status === 'FAIL')
  const passed = rows.filter((row) => row.status === 'PASS')
  const skipped = rows.filter((row) => row.status === 'SKIP')

  if (failed.length) {
    return {
      ok: false,
      message: `${failed.length} target(s) did not run the browser they claim: ${failed
        .map((row) => `${row.target} (${row.detail})`)
        .join('; ')}`
    }
  }

  const proved = `${passed.length} of ${rows.length} target(s) ran the browser the card names`
  const skippedNames = skipped.map((row) => row.target).join(', ')

  if (passed.length === 0 && !allowSkips) {
    return {
      ok: false,
      message: `${proved}${skipped.length ? ` (skipped: ${skippedNames})` : ''}, so this run proved nothing. Install at least one target, or pass --allow-skips to accept a run with no coverage.`
    }
  }

  return {
    ok: true,
    message: `PASS: ${proved}${skipped.length ? `, ${skipped.length} skipped (${skippedNames})` : ''}`
  }
}
