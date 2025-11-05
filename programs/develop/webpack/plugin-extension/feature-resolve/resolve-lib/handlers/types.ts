import type {SWCString, SWCTemplate} from '../ast'

export type RewriteFn = (
  node: SWCString | SWCTemplate,
  computed: string | undefined,
  rawInput?: string
) => void
