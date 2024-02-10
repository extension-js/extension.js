import puzzle from '../public/puzzle.png'
import './styles.css'

export default function PopupApp () {
  return (
    <main>
      <img src={puzzle} alt='puzzle' />
      <h1>Your extension popup</h1>
      <div>🧩</div>
    </main>
  )
}
