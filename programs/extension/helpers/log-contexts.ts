//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export const LOG_CONTEXTS = [
  'background',
  'content',
  'page',
  'popup',
  'options',
  'sidebar',
  'devtools',
  'newtab',
  'history',
  'bookmarks'
] as const

export type LogContext = (typeof LOG_CONTEXTS)[number]
