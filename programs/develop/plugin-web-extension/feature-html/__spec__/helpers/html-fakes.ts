export type SourceValue = string | Buffer
export type FakeSource = {source: () => SourceValue}
export type FakeAsset = {source: FakeSource}
export type BuildIssue = Error & {file?: string}

export function isFakeSource(value: unknown): value is FakeSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {source?: unknown}).source === 'function'
  )
}

// What a source the step emitted reads back as. A plain value is the text
// or bytes the step passed as is.
export function readSource(src: unknown): SourceValue {
  return isFakeSource(src) ? src.source() : (src as SourceValue)
}
