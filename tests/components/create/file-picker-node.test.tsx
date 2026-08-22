import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { FilePickerNode } from '@/components/create/nodes/file-picker-node';
import type { WorkflowNodeData } from '@/types/workflow';

function renderNode(config: WorkflowNodeData['config'], selected = false) {
  const data: WorkflowNodeData = {
    type: 'filePicker',
    label: 'Media',
    config,
  };

  return render(
    <ReactFlowProvider>
      <FilePickerNode
        {...({
          id: 'media-node',
          data,
          selected,
          type: 'filePicker',
          dragging: false,
          zIndex: 0,
          isConnectable: true,
          positionAbsoluteX: 0,
          positionAbsoluteY: 0,
        } as never)}
      />
    </ReactFlowProvider>,
  );
}

describe('FilePickerNode visual media layout', () => {
  it('renders an imported image as the full node surface with its output handle', () => {
    const { container } = renderNode({
      fileUrl: 'https://media.example/frame.jpg',
      fileType: 'image',
      fileName: 'frame.jpg',
    });

    expect(screen.getByRole('img', { name: 'frame.jpg' })).toHaveClass('file-picker-node__media');
    expect(container.querySelector('.file-picker-node--visual')).toBeInTheDocument();
    expect(container.querySelector('.cinegen-node__header')).not.toBeInTheDocument();
    expect(container.querySelector('.react-flow__handle-right')).toBeInTheDocument();
    expect(screen.getByText('output')).toBeInTheDocument();
  });

  it('renders video directly in the full-bleed node instead of a thumbnail card', () => {
    const { container } = renderNode({
      fileUrl: 'https://media.example/take.mp4',
      fileType: 'video',
      fileName: 'take.mp4',
    });

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://media.example/take.mp4');
    expect(video).toHaveAttribute('controls');
    expect(container.querySelector('.file-picker-node__preview-bar')).not.toBeInTheDocument();
  });

  it('shows resize controls when a visual media node is selected', () => {
    const { container } = renderNode({
      fileUrl: 'https://media.example/frame.jpg',
      fileType: 'image',
      fileName: 'frame.jpg',
    }, true);

    expect(container.querySelectorAll('.media-node-resizer__handle')).toHaveLength(4);
    expect(container.querySelectorAll('.media-node-resizer__line')).toHaveLength(4);
  });

  it('keeps the upload dropzone for an empty node', () => {
    const { container } = renderNode({ fileUrl: '', fileType: '', fileName: '' });

    expect(container.querySelector('.file-picker-node__dropzone')).toBeInTheDocument();
    expect(container.querySelector('.file-picker-node--visual')).not.toBeInTheDocument();
  });
});
