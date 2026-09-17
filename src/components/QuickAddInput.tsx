'use client'

import { useRef, useEffect, type CSSProperties } from 'react'
import type { QuickAddToken, TokenType } from '@/lib/quick-add'

/**
 * The quick-add field, with recognised tokens highlighted where they were typed.
 *
 * Two layers sharing one box: a backdrop that draws the highlight rectangles
 * and the real textarea on top of it. The backdrop renders the *same string* in
 * transparent ink, so the only thing it contributes is the coloured background
 * behind the matched spans; the visible glyphs are always the textarea's own.
 *
 * That means the two layers must lay text out identically — same font, size,
 * line height, padding and border box. Any difference shows up as highlights
 * drifting away from the words they belong to, and it gets worse the further
 * down the line you read. The shared constants below are the reason the
 * geometry is written once rather than twice.
 */

/** Every metric that affects where a glyph lands. Applied to both layers. */
const BOX = 'w-full text-sm leading-relaxed rounded-xl border px-3 py-2.5'

/** Wrapping must agree too — a textarea hard-wraps on whitespace and breaks long words. */
const WRAP: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
}

const TOKEN_STYLE: Record<TokenType, string> = {
  date:       'bg-accent-100  dark:bg-accent-500/30  rounded-[3px]',
  time:       'bg-sky-100     dark:bg-sky-500/30     rounded-[3px]',
  recurrence: 'bg-violet-100  dark:bg-violet-500/30  rounded-[3px]',
  project:    'bg-emerald-100 dark:bg-emerald-500/30 rounded-[3px]',
  priority:   'bg-amber-100   dark:bg-amber-500/30   rounded-[3px]',
  duration:   'bg-rose-100    dark:bg-rose-500/30    rounded-[3px]',
  label:      'bg-slate-200   dark:bg-slate-600/50   rounded-[3px]',
}

interface Props {
  value: string
  onChange: (next: string) => void
  /** Enter without Shift. Shift+Enter still inserts a newline. */
  onSubmit?: () => void
  tokens: QuickAddToken[]
  placeholder?: string
  autoFocus?: boolean
  rows?: number
}

export default function QuickAddInput({
  value, onChange, onSubmit, tokens, placeholder, autoFocus, rows = 2,
}: Props) {
  const taRef       = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (autoFocus) taRef.current?.focus() }, [autoFocus])

  /**
   * Keep the backdrop at the textarea's scroll offset. Without this the
   * highlights stay pinned to the top of the box while the text scrolls under
   * them, which is worse than having no highlights at all.
   */
  function syncScroll() {
    if (backdropRef.current && taRef.current) {
      backdropRef.current.scrollTop  = taRef.current.scrollTop
      backdropRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }
  useEffect(syncScroll, [value, tokens])

  // Alternating plain / highlighted runs over the original string. Tokens
  // arrive in source order and never overlap, so one pass is enough.
  const pieces: { text: string; type: TokenType | null }[] = []
  let cursor = 0
  for (const t of tokens) {
    if (t.start > cursor) pieces.push({ text: value.slice(cursor, t.start), type: null })
    pieces.push({ text: value.slice(t.start, t.end), type: t.type })
    cursor = t.end
  }
  pieces.push({ text: value.slice(cursor), type: null })

  return (
    <div className="relative">
      {/* The backdrop carries the field's background, because the textarea
          stacked on top of it has to be transparent — an opaque one would
          paint straight over the highlights it is supposed to reveal. */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        style={WRAP}
        className={`${BOX} absolute inset-0 overflow-hidden pointer-events-none
                    bg-slate-50 dark:bg-slate-800
                    border-transparent text-transparent select-none`}
      >
        {pieces.map((piece, i) =>
          piece.type
            ? <span key={i} className={TOKEN_STYLE[piece.type]}>{piece.text}</span>
            : <span key={i}>{piece.text}</span>,
        )}
        {/* A trailing newline is not rendered by the browser but does take a
            line in the textarea, so without this the two layers disagree on
            height the moment the text ends in a return. */}
        {value.endsWith('\n') && ' '}
      </div>

      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && onSubmit) { e.preventDefault(); onSubmit() }
        }}
        rows={rows}
        placeholder={placeholder}
        spellCheck={false}
        style={WRAP}
        className={`${BOX} relative bg-transparent
                    border-slate-200 dark:border-slate-700
                    text-slate-800 dark:text-slate-200 caret-accent-600
                    resize-none focus:outline-none focus:ring-2 focus:ring-accent-500`}
      />
    </div>
  )
}
