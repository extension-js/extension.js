// The suites assert on exact human-readable output. A caller's FORCE_COLOR
// wraps that output in ANSI and breaks the assertions, so color is forced
// off before any message module loads: monochrome is the test contract.
// Spawned CLI children inherit this environment too.
process.env.FORCE_COLOR = '0'
process.env.NO_COLOR = '1'
