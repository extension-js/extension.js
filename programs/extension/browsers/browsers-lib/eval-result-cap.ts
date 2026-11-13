// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export const MAX_RESULT_BYTES = 256 * 1024
export const TRUNCATED_PREVIEW_CHARS = 1024

export type CappedEvalValue =
  | {ok: true; value: unknown}
  | {
      ok: true
      truncated: true
      value: {__type: 'truncated'; preview: string}
    }

export function truncatedEvalValue(json: string): CappedEvalValue {
  return {
    ok: true,
    truncated: true,
    value: {
      __type: 'truncated',
      preview: json.slice(0, TRUNCATED_PREVIEW_CHARS)
    }
  }
}

export function capEvalValue(value: unknown): CappedEvalValue {
  const json = JSON.stringify(value)

  return json !== undefined && json.length > MAX_RESULT_BYTES
    ? truncatedEvalValue(json)
    : {ok: true, value}
}
