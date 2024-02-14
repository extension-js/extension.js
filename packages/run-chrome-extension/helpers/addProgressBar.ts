// @ts-ignore
import ProgressBar from 'progress'

export default function addProgressBar(
  text: string,
  completionCallback: () => void
) {
  const contentLength = 128 * 1024
  const bar = new ProgressBar(`${text} [:bar] :percent :etas`, {
    complete: '=',
    incomplete: ' ',
    width: 50,
    total: contentLength
  })

  const timer = setInterval(() => {
    const chunk = Math.random() * 10 * 1024
    bar.tick(chunk)

    if (bar.complete) {
      clearInterval(timer)
      completionCallback()
    }
  }, 50)
}
