// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const UPDATE_FLAGS = new Set(['-u', '--update'])
const UPDATE_TYPES = new Set(['all', 'new', 'none', 'true', 'false'])

// The update flag takes an optional type, so vitest reads the word after it
// as that type. A file filter written there is gone and the suite runs.
function swallowsNext(argv, index) {
  const next = argv[index + 1]

  return (
    UPDATE_FLAGS.has(argv[index]) &&
    next !== undefined &&
    !next.startsWith('-') &&
    !UPDATE_TYPES.has(next)
  )
}

// What vitest would drop from these arguments, in the order it was written.
export function droppedVitestFilters(argv) {
  const dashes = argv.indexOf('--')
  const before = dashes === -1 ? argv : argv.slice(0, dashes)
  const dropped = before.filter((_arg, index) =>
    swallowsNext(before, index - 1)
  )

  return dashes === -1 ? dropped : [...dropped, ...argv.slice(dashes + 1)]
}

// The same arguments with every filter where vitest reads it as a filter:
// no separator, and the update flag last, where nothing follows it.
export function keepVitestFilters(argv) {
  const kept = []
  const moved = []

  argv.forEach((arg, index) => {
    if (arg === '--') return

    if (swallowsNext(argv, index)) moved.push(arg)
    else kept.push(arg)
  })

  return [...kept, ...moved]
}

// The message a config throws so a direct vitest call stops before it runs.
export function droppedVitestFiltersMessage(argv) {
  const dropped = droppedVitestFilters(argv)

  if (dropped.length === 0) return undefined

  return `vitest would drop ${dropped.join(' ')} as a file filter and run the whole suite. Run it as: vitest ${keepVitestFilters(argv).join(' ')}`
}
