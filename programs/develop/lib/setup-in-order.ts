// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const lastSetup = new WeakMap<object, Promise<unknown>>()

// A dev run starts every async setup at once. Queued per compiler they write
// their rules in the order the config lists them, as a build does.
export function setupInOrder<T>(
  compiler: object,
  setup: () => Promise<T>
): Promise<T> {
  const previous = lastSetup.get(compiler) || Promise.resolve()
  const next = previous.then(
    () => setup(),
    () => setup()
  )

  lastSetup.set(compiler, next)

  return next
}
