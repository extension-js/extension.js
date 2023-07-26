// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import {type TerserOptions} from 'terser-webpack-plugin'

interface JSOptimizationType {
  terserOptions: TerserOptions
}

const jsOptimization: JSOptimizationType = {
  terserOptions: {
    parse: {
      // Enable compress options that will transform ES5 code into
      // smaller ES6+ equivalent forms.
      ecma: 2020
    },
    compress: {
      // Enable compress options that will transform ES5 code into
      // smaller ES6+ equivalent forms.
      ecma: 2020
    },
    // Work around the Safari 10 loop iterator bug
    // "Cannot declare a let variable twice"
    // https://bugs.webkit.org/show_bug.cgi?id=171041
    mangle: {
      safari10: true
    },
    format: {
      ecma: 5,
      // Work around the Safari 10/11 await bug.
      // https://bugs.webkit.org/show_bug.cgi?id=176685
      safari10: true,
      comments: false,
      // escape Unicode characters in strings and regexps
      // (affects directives with non-ascii characters becoming invalid)
      ascii_only: true
    }
  }
}

export default jsOptimization
