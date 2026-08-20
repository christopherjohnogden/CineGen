

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const MENU_MAX_HEIGHT = 240;
const MENU_MARGIN = 4;

export function CustomSelect({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  className,
}: CustomSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const selected = options.find((option) => option.value === value);

  const openMenu = useCallback(() => {
    const index = options.findIndex((option) => option.value === value);
    setHighlighted(index >= 0 ? index : 0);
    setOpen(true);
  }, [options, value]);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (option) onChange(option.value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [options, onChange],
  );

  // Position the menu against the trigger; flip above when the viewport bottom would clip it
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN * 2;
    const spaceAbove = rect.top - MENU_MARGIN * 2;
    const contentHeight = menuRef.current?.scrollHeight ?? MENU_MAX_HEIGHT;
    const openUp = spaceBelow < Math.min(contentHeight, MENU_MAX_HEIGHT) && spaceAbove > spaceBelow;
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(80, Math.min(MENU_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow)),
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + MENU_MARGIN }
        : { top: rect.bottom + MENU_MARGIN }),
    });
  }, [open]);

  // Close on outside pointer, ambient scroll, or resize
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Keep the highlighted option in view while navigating
  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlighted]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setHighlighted(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlighted(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(highlighted);
        break;
      case 'Escape':
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={[
          'custom-select__trigger',
          open && 'custom-select__trigger--open',
          className,
        ].filter(Boolean).join(' ')}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span
          className={
            selected
              ? 'custom-select__value'
              : 'custom-select__value custom-select__value--placeholder'
          }
        >
          {selected?.label ?? placeholder}
        </span>
        <svg
          className={`custom-select__chevron${open ? ' custom-select__chevron--open' : ''}`}
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && createPortal(
        <div ref={menuRef} className="custom-select__menu" style={menuStyle} role="listbox">
          {options.map((option, index) => (
            <div
              key={option.value}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              className={[
                'custom-select__option',
                option.value === value && 'custom-select__option--selected',
                index === highlighted && 'custom-select__option--active',
              ].filter(Boolean).join(' ')}
              onPointerEnter={() => setHighlighted(index)}
              onClick={() => commit(index)}
            >
              <span className="custom-select__option-label">{option.label}</span>
              {option.value === value && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                  <path
                    d="M1 4L3.5 6.5L9 1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
