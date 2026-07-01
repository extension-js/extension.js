// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

// Shared static types for the Firefox Remote Debugging Protocol (RDP) wire
// surface. These are recovered from how the runner actually READS frames and
// calls the client — every field is optional because the wire reads are loose
// (`message?.type`, `target?.consoleActor`, …) and Firefox omits fields per
// message kind. Nothing here changes runtime behavior; it only gives the
// already-existing reads a real, checkable shape instead of an escape hatch.

/**
 * A tab/target descriptor as returned by `listTabs` / `getTargets`. Different
 * Firefox versions surface the console actor under different keys and may or
 * may not include `outerWindowID*`, so every field is optional.
 */
export interface RdpTarget {
  actor?: string
  url?: string
  type?: string
  consoleActor?: string
  webConsoleActor?: string
  outerWindowID?: number
  outerWindowId?: number
}

/**
 * A decoded RDP frame as read by the console/log forwarders. The structure is
 * self-referential because the console-API payload nests the same shape
 * (`message.message`, `arguments[]`, `value`/`text`) and the readers walk it
 * generically. Stringy fields the readers feed straight into `String(...)` or
 * assign to `string | undefined` locals are typed `string`; fields the readers
 * descend into are typed back to `RdpMessage`.
 */
export interface RdpMessage {
  from?: string
  type?: string
  error?: unknown
  errorMessage?: string
  cause?: string
  url?: string
  sourceURL?: string
  level?: string
  category?: string
  filename?: string
  sourceName?: string
  message?: RdpMessage
  text?: RdpMessage
  value?: RdpMessage
  arguments?: RdpMessage[]
}

/**
 * A console/eval result value or `longString` grip. Leaf fields the coercers
 * read with a `typeof === 'string'` guard or assign to string locals.
 */
export interface RdpLongStringValue {
  value?: string
  text?: string
  preview?: {text?: string}
  type?: string
  initial?: string
  length?: number
  actor?: string
}

/**
 * The raw protocol response handed back by an `evaluateJS*` request. The
 * coercers read `result`/`value` (which may themselves be a value grip) and,
 * for `longString` grips, the `substring` reply from the long-string actor.
 */
export interface RdpEvalResponse {
  result?: RdpLongStringValue
  value?: RdpLongStringValue
  text?: string
  preview?: {text?: string}
  type?: string
  initial?: string
  length?: number
  actor?: string
  substring?: string
}
