import { useState } from 'react'
import { Search } from 'lucide-react'

interface SearchBarProps {
  query?: string
  onChange?: (query: string) => void
}

export function SearchBar({ query, onChange }: SearchBarProps) {
  const [localQuery, setLocalQuery] = useState('')

  const value = query !== undefined ? query : localQuery
  const handleChange = (v: string) => {
    if (onChange) onChange(v)
    setLocalQuery(v)
  }

  return (
    <div className="relative">
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        type="text"
        value={value}
        onChange={e => handleChange(e.target.value)}
        placeholder="搜索博文..."
        className="w-full pl-7 pr-3 py-1.5 text-[13px] bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--border-color)] rounded placeholder-[#6a6a6a] focus:outline-none focus:border-[var(--accent)]"
      />
    </div>
  )
}
