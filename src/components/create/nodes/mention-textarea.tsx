

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Element } from '@/types/elements';

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  elements: Element[];
  disabled?: boolean;
}

export function MentionTextarea({ value, onChange, placeholder, rows = 5, elements, disabled }: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [selectedIdx, setSelectedIdx] = useState(0);
  const mentionStartRef = useRef<number>(-1);

  const filtered = elements.filter((el) =>
    el.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const updateDropdownPosition = useCallback(() => {
    const textarea = textareaRef.current;
    const container = containerRef.current;
    if (!textarea || !container) return;

    // Approximate position based on cursor
    const textBefore = value.slice(0, textarea.selectionStart);
    const lines = textBefore.split('\n');
    const lineHeight = 18;
    const charWidth = 7.2;
    const top = lines.length * lineHeight + 4;
    const left = Math.min((lines[lines.length - 1]?.length ?? 0) * charWidth, textarea.offsetWidth - 160);

    setDropdownPos({ top, left: Math.max(0, left) });
  }, [value]);

  const insertMention = useCallback((element: Element) => {
    const start = mentionStartRef.current;
    if (start < 0) return;

    const textarea = textareaRef.current;
    const before = value.slice(0, start);
    const after = value.slice(textarea?.selectionStart ?? value.length);
    const mention = `@${element.name}`;
    const newValue = before + mention + (after.startsWith(' ') ? '' : ' ') + after;

    onChange(newValue);
    setShowDropdown(false);
    setFilter('');
    mentionStartRef.current = -1;

    // Restore focus after state update
    requestAnimationFrame(() => {
      if (textarea) {
        const cursorPos = before.length + mention.length + (after.startsWith(' ') ? 0 : 1);
        textarea.focus();
        textarea.setSelectionRange(cursorPos, cursorPos);
      }
    });
  }, [value, onChange]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    onChange(newValue);

    // Check if we should open/update the mention dropdown
    const textBefore = newValue.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf('@');

    if (atIndex >= 0) {
      const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : ' ';
      const textAfter = textBefore.slice(atIndex + 1);

      // @ must be preceded by whitespace or be at the start
      if (atIndex === 0 || /\s/.test(charBefore)) {
        // No spaces in the filter text (means they moved past the mention)
        if (!/\s/.test(textAfter)) {
          mentionStartRef.current = atIndex;
          setFilter(textAfter);
          setShowDropdown(true);
          setSelectedIdx(0);
          return;
        }
      }
    }

    setShowDropdown(false);
    setFilter('');
    mentionStartRef.current = -1;
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown || filtered.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(filtered[selectedIdx]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }, [showDropdown, filtered, selectedIdx, insertMention]);

  // Update dropdown position when showing
  useEffect(() => {
    if (showDropdown) updateDropdownPosition();
  }, [showDropdown, updateDropdownPosition]);

  // Render highlighted text for the backdrop
  const renderHighlighted = () => {
    // Match @ElementName patterns
    const parts = value.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@') && elements.some((el) => `@${el.name}` === part)) {
        return <mark key={i} className="mention-textarea__highlight">{part}</mark>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div ref={containerRef} className="mention-textarea nodrag nowheel" style={{ position: 'relative' }}>
      <div className="mention-textarea__backdrop" aria-hidden>
        {renderHighlighted()}
      </div>
      <textarea
        ref={textareaRef}
        className="mention-textarea__input cinegen-node__textarea"
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
      />
      {showDropdown && filtered.length > 0 && (
        <div
          className="mention-textarea__dropdown"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {filtered.map((el, i) => (
            <button
              key={el.id}
              type="button"
              className={`mention-textarea__option${i === selectedIdx ? ' mention-textarea__option--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(el);
              }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              {el.images[0]?.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={el.images[0].url} alt="" className="mention-textarea__option-img" />
              )}
              <span className="mention-textarea__option-name">{el.name}</span>
              <span className="mention-textarea__option-type">{el.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
