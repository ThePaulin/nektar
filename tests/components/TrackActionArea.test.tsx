import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TrackActionArea } from '@/src/components/TrackActionArea';
import { TrackType } from '@/src/types';
import { makeTrack } from '../factories/editor';

describe('TrackActionArea', () => {
  it('creates text clips via the text action', async () => {
    const user = userEvent.setup();
    const onAddText = vi.fn();

    render(
      <TrackActionArea
        track={makeTrack({ type: TrackType.TEXT, name: 'Text 1', isArmed: false })}
        recordingMode="insert"
        onImport={vi.fn()}
        onAddText={onAddText}
      />,
    );

    await user.click(screen.getByRole('button', { name: /create new/i }));
    expect(onAddText).toHaveBeenCalledTimes(1);
  });

  it('imports files for media tracks', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();

    render(
      <TrackActionArea
        track={makeTrack({ type: TrackType.VIDEO })}
        recordingMode="append"
        onImport={onImport}
        onAddText={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /choose file/i }));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/append mode/i)).toBeInTheDocument();
  });
});
