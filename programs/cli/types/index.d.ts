/// <reference types="node" />
/// <reference types="react" />
/// <reference types="react-dom" />
/// <reference types="chrome" />
/// <reference path="./css-content.d.ts" />
/// <reference path="./css-modules.d.ts" />
/// <reference path="./images.d.ts" />
/// <reference types="svelte" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXTENSION_ENV: 'development' | 'production' | 'test' | 'debug'
  }
}
