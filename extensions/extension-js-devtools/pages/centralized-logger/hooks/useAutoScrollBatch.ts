import {useEffect, useRef, useState} from 'react'

export function useAutoScrollBatch<T>(items: T[], autoScroll: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [visibleItems, setVisibleItems] = useState<T[]>(items)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)

  useEffect(() => {
    let raf: number | null = null

    const id = setInterval(() => {
      setVisibleItems(items)
      if (!isUserScrolledUp && autoScroll && containerRef.current) {
        raf = requestAnimationFrame(() => {
          containerRef.current!.scrollTop = containerRef.current!.scrollHeight
        })
      }
    }, 50)

    return () => {
      clearInterval(id)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [items, autoScroll, isUserScrolledUp])

  useEffect(() => {
    if (!autoScroll || isUserScrolledUp) return

    const el = containerRef.current

    if (!el) return

    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })

    return () => cancelAnimationFrame(id)
  }, [visibleItems, autoScroll, isUserScrolledUp])

  useEffect(() => {
    if (!autoScroll) return

    const el = containerRef.current

    if (!el) return

    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })

    return () => cancelAnimationFrame(id)
  }, [autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return

    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    setIsUserScrolledUp(!atBottom)
  }

  return {containerRef, visibleItems, handleScroll}
}
