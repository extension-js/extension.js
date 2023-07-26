import {useState} from 'react'

export function App() {
  const [count, setCount] = useState(100)

  const handlePlusOne = () => {
    setCount((prevCount) => prevCount + 1)
  }

  const handleMinusOne = () => {
    setCount((prevCount) => prevCount - 1)
  }
  return (
    <div>
      <h1>🧩 How cool are browser extensions?</h1>
      <h2>(using React)</h2>
      <section>
        <div>
          <button onClick={handleMinusOne}>-</button>
        </div>
        <div>
          <span>{count}%</span>
        </div>
        <div>
          <button onClick={handlePlusOne}>+</button>
        </div>
      </section>
    </div>
  )
}
