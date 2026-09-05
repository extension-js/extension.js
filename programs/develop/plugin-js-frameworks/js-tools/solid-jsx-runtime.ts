//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Browser-side adapter: the automatic JSX runtime shape (jsx, jsxs, jsxDEV,
// Fragment) on top of Solid's hyperscript entry, which is the runtime JSX
// path Solid ships without its Babel preset.
// @ts-expect-error solid-js belongs to the user's project; the alias resolves it there
import h from 'solid-js/h'

type Props = Record<string, unknown> & {children?: unknown}
type Hyperscript = (
  type: unknown,
  props?: unknown,
  children?: unknown
) => unknown
const hyperscript: Hyperscript = h

export function Fragment(props: Props) {
  return props.children
}

export function jsx(type: unknown, props: Props = {}, key?: unknown) {
  const {children, ...rest} = props
  if (key !== undefined) rest.key = key
  return children === undefined
    ? hyperscript(type, rest)
    : hyperscript(type, rest, children)
}

export const jsxs = jsx

export function jsxDEV(type: unknown, props: Props = {}, key?: unknown) {
  return jsx(type, props, key)
}
