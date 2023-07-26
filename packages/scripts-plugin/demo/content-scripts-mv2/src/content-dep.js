console.log('content script dep!')

function sum(a, b) {
  return a + b
}

console.log('sum from dep', sum(1, 2))
