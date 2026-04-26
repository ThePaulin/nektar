import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClipPropertiesPanel } from '@/src/components/ClipPropertiesPanel';
import { TrackType } from '@/src/types';
import { makeClip } from '../factories/editor';

describe('ClipPropertiesPanel', () => {
  it('updates text content and typography controls', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <ClipPropertiesPanel
        clip={makeClip({
          id: 5,
          type: TrackType.TEXT,
          content: 'Hello',
          style: { fontFamily: 'Inter', fontSize: 48, color: '#ffffff' },
        })}
        onUpdate={onUpdate}
      />,
    );

    await user.clear(screen.getByPlaceholderText(/enter text/i));
    await user.type(screen.getByPlaceholderText(/enter text/i), 'Updated');
    await user.selectOptions(screen.getByDisplayValue('Inter'), 'Roboto');

    expect(onUpdate).toHaveBeenCalled();
    expect(screen.getByText(/clip properties/i)).toBeInTheDocument();
    expect(screen.getByText(/typography/i)).toBeInTheDocument();
  });

  it('resets transform values for media clips', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <ClipPropertiesPanel
        clip={makeClip({
          id: 6,
          type: TrackType.VIDEO,
          transform: {
            position: { x: 10, y: 20, z: 0 },
            rotation: 12,
            scale: { x: 2, y: 2 },
            opacity: 0.5,
            crop: { top: 1, right: 2, bottom: 3, left: 4 },
          },
        })}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getAllByRole('button').find((button) => button.querySelector('svg'))!);
    expect(onUpdate).toHaveBeenCalled();
  });
});
