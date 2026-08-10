// Provider component for the timeline-persistence toggle.
// Lives in a `.tsx` file so the JSX in the component body
// stays out of the test command's `--experimental-strip-types`
// glob (which only handles `.ts`). The provider writes the
// value to `localStorage` via [writeStoredPersistRuns] so
// the test command can exercise the storage contract
// without spinning up the full React tree.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PersistenceContext, readStoredPersistRuns, writeStoredPersistRuns, type PersistenceContextValue } from './persistenceStorage.ts'

export function PersistenceProvider({ children }: { children: ReactNode }) {
  const [persistRuns, setPersistRunsState] = useState<boolean>(readStoredPersistRuns)

  // Persist on every change so the next visit lands in the
  // same mode. The setter is stable so child components
  // can list it in dependency arrays without churn.
  useEffect(() => {
    writeStoredPersistRuns(persistRuns)
  }, [persistRuns])

  const setPersistRuns = useCallback((next: boolean) => {
    setPersistRunsState(next)
  }, [])

  const value = useMemo<PersistenceContextValue>(
    () => ({ persistRuns, setPersistRuns }),
    [persistRuns, setPersistRuns],
  )
  return <PersistenceContext.Provider value={value}>{children}</PersistenceContext.Provider>
}
