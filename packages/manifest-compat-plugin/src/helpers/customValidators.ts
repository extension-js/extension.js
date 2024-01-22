import Ajv from 'ajv'

export function addCustomFormats(ajv: Ajv) {
  // Permission format
  ajv.addFormat('permission', {
    type: 'string',
    validate: (data: any) => typeof data === 'string' && data.trim() !== ''
  })

  // Content-security-policy format
  ajv.addFormat('content-security-policy', {
    type: 'string',
    validate: (data: any) => typeof data === 'string'
  })

  // Glob pattern format
  ajv.addFormat('glob-pattern', {
    type: 'string',
    validate: (data: any) => {
      // Basic glob pattern validation
      return typeof data === 'string' && /[\*\?\[\]]/.test(data)
    }
  })

  // Match pattern format
  // https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
  ajv.addFormat('match-pattern', {
    type: 'string',
    validate: (data: any) => {
      // Special cases
      // * "<all_urls>" - Matches any URL that starts with a permitted scheme,
      // including any pattern listed under valid patterns. Because it affects
      // all hosts, Chrome web store reviews for extensions that use it may take longer.
      // * "file:///" Allows your extension to run on local files. This pattern requires
      // the user to manually grant access. Note that this case requires three slashes, not two.
      // * Localhost URLs and IP addresses
      // To match any localhost port during development, use http://localhost/*.
      // For IP addresses, specify the address plus a wildcard in the path, as in
      // http://127.0.0.1/*. You can also use http://*:*/* to match localhost, IP addresses,
      // and any port.
      // * Top Level domain match patterns
      // Chrome doesn't support match patterns for top Level domains (TLD). Specify your
      // match patterns within individual TLDs, as in http://google.es/* and
      // http://google.fr/*.
      if (data === '<all_urls>') return true
      if (data === 'file:///') return true
      if (data.startsWith('http://localhost')) return true
      if (data.startsWith('http://  ')) return true
      if (data.startsWith('http://*:*/*')) return true

      // Basic URL pattern validation
      return (
        typeof data === 'string' && /^(\*|http|https|file|ftp):\/\//.test(data)
      )
    }
  })

  // URI format
  ajv.addFormat('uri', {
    type: 'string',
    validate: (data: any) => {
      // Basic URI validation
      return typeof data === 'string' && /^(\w+:)?\/\//.test(data)
    }
  })

  // MIME type format
  ajv.addFormat('mime-type', {
    type: 'string',
    validate: (data: any) => {
      // Basic MIME type validation
      return typeof data === 'string' && /^[a-z]+\/[a-z0-9\-\+]+$/.test(data)
    }
  })

  // Add more custom formats as needed...
}

export default addCustomFormats
