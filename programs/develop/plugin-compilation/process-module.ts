//  ██████╗ ██████╗ ███╗   ███╗██████╗ ██╗██╗      █████╗ ████████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██║██║     ██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║
// ██║     ██║   ██║██╔████╔██║██████╔╝██║██║     ███████║   ██║   ██║██║   ██║██╔██╗ ██║
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██║██║     ██╔══██║   ██║   ██║██║   ██║██║╚██╗██║
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║███████╗██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {toJsStringLiteral} from '../lib/js-literal'

// A bundle has no process global, so code that reads one is handed this
// module. Its env carries the public values import.meta.env carries.
export function processModuleSource(env: Record<string, string>): string {
  const entries = Object.keys(env).map(
    (key) => `${toJsStringLiteral(key)}:${toJsStringLiteral(env[key])}`
  )

  return [
    'const noop=()=>{};',
    // typeof process is "object" here, so a library may take its Node branch
    // and time itself or warn: those calls answer instead of throwing.
    'const now=()=>(globalThis.performance||Date).now();',
    'const hrtime=(p)=>{const d=now()*1e6-(p?p[0]*1e9+p[1]:0);return[Math.floor(d/1e9),Math.floor(d%1e9)]};',
    'hrtime.bigint=()=>BigInt(Math.floor(now()*1e6));',
    // A page has no terminal, so a write lands in the console, whole lines
    // as the logger sent them, and the color checks read a plain stream.
    'const stream=(fd,level)=>({',
    'fd,isTTY:false,writable:true,columns:80,',
    'write:(c,e,cb)=>{',
    'c=String(c);',
    'typeof console=="object"&&(console[level]||console.log).call(console,c.endsWith("\\n")?c.slice(0,-1):c);',
    'cb=typeof e=="function"?e:cb;cb&&cb();',
    'return true',
    '},',
    'end:noop,on:noop,once:noop,off:noop',
    '});',
    'module.exports={',
    `env:{${entries.join(',')}},`,
    'argv:[],',
    'version:"",',
    'versions:{},',
    'platform:"browser",',
    'arch:"browser",',
    'browser:true,',
    'title:"browser",',
    'pid:0,',
    'nextTick:(callback,...args)=>{',
    'const run=()=>{callback(...args)};',
    'if(typeof queueMicrotask==="function"){queueMicrotask(run)}',
    'else{Promise.resolve().then(run)}',
    '},',
    'cwd:()=>"/",',
    'hrtime,',
    'stdout:stream(1,"log"),',
    'stderr:stream(2,"error"),',
    'emitWarning:(w)=>{typeof console=="object"&&console.warn&&console.warn(String(w))},',
    'chdir:noop,',
    'umask:()=>0,',
    'on:noop,',
    'once:noop,',
    'off:noop,',
    'addListener:noop,',
    'removeListener:noop,',
    'removeAllListeners:noop,',
    'prependListener:noop,',
    'prependOnceListener:noop,',
    'emit:noop,',
    'listeners:()=>[]',
    '};'
  ].join('')
}

// Base64 leaves no dot, quote or percent sign in the request, so no module
// rule takes it for a file by its name and no value can cut the URI short.
export function processModuleRequest(env: Record<string, string>): string {
  const source = Buffer.from(processModuleSource(env)).toString('base64')

  // This media type is the one the bundler reads as CommonJS.
  return `data:application/node;base64,${source}`
}
