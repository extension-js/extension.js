import puzzle from '../public/puzzle.png'

export default function NewTabApp () {
  return (
    <div className='hello-box'>
      <header>
        <img src={puzzle} alt='A puzzle icon' />
        <h1>Welcome to your extension</h1>
        <p className='description loading'>Browser extensions are 🙌🙌🙌</p>
      </header>
      <p>
        This page is being watched, and so are all entries in manifest.json.
        Happy hacking!!
      </p>
    </div>
  )
}
