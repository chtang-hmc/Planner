'use client'

import { createContext, useContext, useState } from 'react'

interface SearchCtx {
  query: string
  setQuery: (q: string) => void
}

const SearchContext = createContext<SearchCtx>({ query: '', setQuery: () => {} })

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState('')
  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      {children}
    </SearchContext.Provider>
  )
}

export function useSearch() {
  return useContext(SearchContext)
}
