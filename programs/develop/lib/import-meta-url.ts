//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {toJsStringLiteral} from './js-literal'

// Extension pages and workers keep their own URL, content scripts get the
// extension root, and a MAIN world script without a runtime gets the page URL.
export const IMPORT_META_URL_RUNTIME =
  '(function(){var h=typeof document!=="undefined"&&document.baseURI||self.location.href;try{var g=globalThis,r=(g.browser||g.chrome).runtime.getURL("/");return h.indexOf(r)===0?h:r}catch(_){return h}})()'

// A file the runtime loads by URL is emitted at one known path, so its
// import.meta.url is that path. Without a runtime (MAIN world) the page URL stands in.
export function importMetaUrlForEmitPath(emitPath: string): string {
  const request = emitPath.replace(/\\/g, '/').replace(/^\/+/, '')

  return `(function(){try{var g=globalThis;return (g.browser||g.chrome).runtime.getURL(${toJsStringLiteral(request)})}catch(_){return ${IMPORT_META_URL_RUNTIME}}})()`
}
