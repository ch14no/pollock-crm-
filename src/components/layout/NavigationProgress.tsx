'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

const NAVIGATION_START_EVENT = 'app:navigation-start'
const SAFETY_TIMEOUT_MS = 5000

// Guard against re-patching lives on `window` (not a module-level variable)
// so it survives dev-mode Fast Refresh re-evaluating this module. A
// module-level flag would reset on every HMR update, causing the
// "original" pushState it captures to actually be the previously-patched
// version, stacking wrappers on every save.
interface NavigationProgressWindow extends Window {
  __navProgressPatched?: boolean
}

function patchHistoryOnce(): void {
  const patchedWindow = window as NavigationProgressWindow
  if (patchedWindow.__navProgressPatched) return
  patchedWindow.__navProgressPatched = true

  const originalPushState = window.history.pushState.bind(window.history)

  // Only pushState is patched. Next.js's router uses pushState for actual
  // route changes and replaceState for internal bookkeeping (scroll
  // restoration, router.refresh(), shallow search-param updates) that
  // aren't user-visible "navigations" — patching replaceState too caused
  // the indicator to flicker on those internal calls.
  window.history.pushState = function patchedPushState(
    ...args: Parameters<typeof window.history.pushState>
  ) {
    window.dispatchEvent(new Event(NAVIGATION_START_EVENT))
    return originalPushState.apply(window.history, args)
  }
}

export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isNavigating, setIsNavigating] = useState(false)
  const safetyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Patch history.pushState once so we can detect navigation start
  // regardless of which call site triggered it (Link or router.push).
  useEffect(() => {
    patchHistoryOnce()
  }, [])

  useEffect(() => {
    function handleNavigationStart() {
      setIsNavigating(true)

      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current)
      }
      safetyTimeoutRef.current = setTimeout(() => {
        setIsNavigating(false)
        safetyTimeoutRef.current = null
      }, SAFETY_TIMEOUT_MS)
    }

    window.addEventListener(NAVIGATION_START_EVENT, handleNavigationStart)
    return () => {
      window.removeEventListener(NAVIGATION_START_EVENT, handleNavigationStart)
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current)
        safetyTimeoutRef.current = null
      }
    }
  }, [])

  // pathname/searchParams reflect the committed route, so when they change
  // (or on mount) the navigation is considered complete.
  useEffect(() => {
    setIsNavigating(false)
    if (safetyTimeoutRef.current) {
      clearTimeout(safetyTimeoutRef.current)
      safetyTimeoutRef.current = null
    }
  }, [pathname, searchParams])

  useEffect(() => {
    document.body.style.cursor = isNavigating ? 'progress' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [isNavigating])

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 z-[100] h-[3px] pointer-events-none"
    >
      <div
        className={`h-full bg-orange-500 transition-all ease-out ${
          isNavigating
            ? 'w-[85%] opacity-100 duration-[4000ms]'
            : 'w-full opacity-0 duration-300'
        }`}
      />
    </div>
  )
}
