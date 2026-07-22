//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Node writes to a piped stdout/stderr asynchronously, so process.exit right
// after a large frame drops every byte past the first pipe buffer.
export async function exitAfterDrain(code: number): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          if (stream.writableLength === 0) return resolve()
          // An empty write's callback fires only after every queued byte
          // ahead of it has been handed to the OS.
          stream.write('', () => resolve())
        })
    )
  )

  process.exit(code)
}
