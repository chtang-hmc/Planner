'use client'

import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import type { QuickAddMiss, QuickAddToken } from '@/lib/quick-add'
import { GROUP } from '@/lib/add-task-model'

/**
 * The quick-add field, with understood fragments marked where they were typed.
 *
 * Two layers sharing one geometry: a backdrop that paints the field, its
 * border and the marks, and the real textarea on top of it. The backdrop holds
 * the *same string* in transparent ink, so the only thing it contributes is
 * paint behind the matched spans; the visible glyphs are always the textarea's.
 *
 * **The backdrop is in flow and sets the height; the textarea covers it
 * exactly.** That way round, the box grows with the text and the textarea
 * never scrolls on its own — so there is no scroll offset to keep the two in
 * step, which the previous stacking had to copy across by hand. Past
 * `max-h` the wrapper scrolls, carrying both layers together.
 *
 * The layers must lay text out identically — same font, size, line height,
 * padding and border box — or the marks drift off their words, worse the
 * further down the text runs. Every such metric is in `BOX` and nowhere else,
 * and the marks carry paint only (see `.qa-mark` in globals.css).
 *
 * 16px on every screen. Below 16px iOS zooms the page when the field takes
 * focus, and one size everywhere means one layout to keep aligned.
 */
const BOX = 'block w-full m-0 rounded-xl border px-[13px] py-[11px] text-base leading-6 font-[inherit] [tab-size:4]'

/** Wrapping must agree too — a textarea hard-wraps on whitespace and breaks long words. */
const WRAP: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
}

interface Props {
  value: string
  onChange: (next: string) => void
  /** Enter without Shift. Shift+Enter still inserts a newline. */
  onSubmit?: () => void
  tokens: QuickAddToken[]
  /** Fragments that looked like syntax and weren't understood: a dashed underline, no wash. */
  misses?: QuickAddMiss[]
  placeholder?: string
  autoFocus?: boolean
  id?: string
  /** The caller's handle on the textarea, to focus it after a chip is used. */
  inputRef?: RefObject<HTMLTextAreaElement | null>
  'aria-label'?: string
  'aria-describedby'?: string
}

export default function QuickAddInput({
  value, onChange, onSubmit, tokens, misses = [], placeholder, autoFocus, id, inputRef, ...aria
}: Props) {
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? ownRef
  useEffect(() => { if (autoFocus) ref.current?.focus() }, [autoFocus, ref])

  // Alternating plain / marked runs over the original string. Tokens and
  // misses arrive in source order and never overlap, so one pass is enough.
  const marks = [
    ...tokens.map(t => ({ start: t.start, end: t.end, cls: `qa-mark qa-${GROUP[t.type]}` })),
    ...misses.map(m => ({ start: m.start, end: m.end, cls: 'qa-miss' })),
  ].sort((a, b) => a.start - b.start)
  const pieces: { text: string; cls: string | null }[] = []
  let cursor = 0
  for (const m of marks) {
    if (m.start > cursor) pieces.push({ text: value.slice(cursor, m.start), cls: null })
    pieces.push({ text: value.slice(m.start, m.end), cls: m.cls })
    cursor = m.end
  }
  pieces.push({ text: value.slice(cursor), cls: null })

  return (
    <div className="group max-h-[170px] overflow-y-auto rounded-xl transition-shadow
                    focus-within:ring-[3px] focus-within:ring-accent-500/30">
      <div className="relative">
        <div
          aria-hidden="true"
          style={WRAP}
          className={`${BOX} min-h-[72px] pointer-events-none select-none text-transparent
                      bg-slate-50 dark:bg-slate-800
                      border-slate-200 dark:border-slate-700 group-focus-within:border-accent-500`}
        >
          {pieces.map((p, i) =>
            p.cls ? <span key={i} className={p.cls}>{p.text}</span> : <span key={i}>{p.text}</span>,
          )}
          {/* A trailing newline takes a line in the textarea but not in a div,
              so without this the two layers disagree on height. */}
          {value.endsWith('\n') && '​'}
        </div>

        <textarea
          ref={ref}
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && onSubmit) {
              e.preventDefault()
              onSubmit()
            }
          }}
          rows={1}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
          style={WRAP}
          className={`${BOX} absolute inset-0 h-full overflow-hidden resize-none
                      bg-transparent border-transparent outline-none
                      text-slate-800 dark:text-slate-100 caret-accent-600
                      placeholder:text-slate-400 dark:placeholder:text-slate-500`}
          {...aria}
        />
      </div>
    </div>
  )
}
