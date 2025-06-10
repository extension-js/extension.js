// Included script with HMR
if (module.hot) {
  module.hot.accept()
}

console.log('Included script loaded')

const text = `Your browser extension injected this script`
alert(text)
