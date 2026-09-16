// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export interface RdpTarget {
  actor?: string
  url?: string
  type?: string
  consoleActor?: string
  webConsoleActor?: string
  outerWindowID?: number
  outerWindowId?: number
}

// A decoded RDP frame as read by the console/log forwarders; self-referential
// because the console-API payload nests the same shape and readers walk it.
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

// A console/eval result value or longString grip; leaf fields are read behind
// typeof === 'string' guards.
export interface RdpLongStringValue {
  value?: string
  text?: string
  preview?: {text?: string}
  type?: string
  initial?: string
  length?: number
  actor?: string
}

// The raw protocol response from an evaluateJS* request; coercers read
// result/value and, for longString grips, the substring reply.
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
