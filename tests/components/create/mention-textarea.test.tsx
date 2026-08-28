import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MentionTextarea } from '@/components/create/nodes/mention-textarea';
import type { Element } from '@/types/elements';

const peter: Element = {
  id: 'el-peter',
  name: 'Peter',
  type: 'character',
  description: '',
  images: [],
  createdAt: '',
  updatedAt: '',
};

function Harness({ onMentionInsert }: {
  onMentionInsert: (element: Element, value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <MentionTextarea
      value={value}
      onChange={setValue}
      onMentionInsert={(element, nextValue) => {
        onMentionInsert(element, nextValue);
        setValue(nextValue);
      }}
      elements={[peter]}
    />
  );
}

describe('MentionTextarea element selections', () => {
  it('returns the selected element ID together with the inserted prompt value', () => {
    const onMentionInsert = vi.fn();
    render(<Harness onMentionInsert={onMentionInsert} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '@Pe', selectionStart: 3 } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onMentionInsert).toHaveBeenCalledWith(peter, '@Peter ');
    expect(textarea).toHaveValue('@Peter ');
  });
});
