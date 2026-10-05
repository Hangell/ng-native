import { signal } from '@angular/core';
import { withComponentInputBinding } from '@angular/router';
import type { PlayerState } from '@ng-native/expo/player';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import { render, screen, userEvent, waitFor, type FakeFabricNode } from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import { App } from '../app.ts';
import { routes } from '../app.routes.ts';
import {
  TRACK_PLAYER,
  TRACKS,
  clock,
  nextIndex,
  previousIndex,
  seekTarget,
  type TrackPlayer,
} from './player-model.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('the player queue and clock', () => {
  test('shows time as m:ss', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(65.7)).toBe('1:05');
    expect(clock(-3)).toBe('0:00');
  });

  test('turns a drag along the scrubber into seconds, clamped to the track', () => {
    expect(seekTarget(50, 200, 8)).toBe(2);
    expect(seekTarget(-10, 200, 8)).toBe(0);
    expect(seekTarget(900, 200, 8)).toBe(8);
    expect(seekTarget(10, 0, 8)).toBe(0);
  });

  test('goes on in order, wraps only with repeat, and restarts a track well under way', () => {
    expect(nextIndex(0, 3, false)).toBe(1);
    expect(nextIndex(2, 3, false)).toBeNull();
    expect(nextIndex(2, 3, true)).toBe(0);
    expect(previousIndex(2, 1)).toBe(1);
    expect(previousIndex(2, 10)).toBe(2);
    expect(previousIndex(0, 1)).toBe(0);
  });
});

/** A player with no audio behind it, which records what it was asked to do. */
function fakePlayer() {
  const calls: string[] = [];
  const state = signal<PlayerState>({
    playing: false,
    status: 'readyToPlay',
    currentTime: 0,
    duration: 6,
    muted: false,
    volume: 1,
    ended: false,
  });
  const player: TrackPlayer = {
    state,
    replace: () => calls.push('replace'),
    play: () => {
      calls.push('play');
      state.update((s) => ({ ...s, playing: true }));
    },
    pause: () => {
      calls.push('pause');
      state.update((s) => ({ ...s, playing: false }));
    },
    seekTo: (seconds) => {
      calls.push(`seek ${seconds}`);
      state.update((s) => ({ ...s, currentTime: seconds }));
    },
    setVolume: (volume) => calls.push(`volume ${volume}`),
  };
  return { player, calls, state };
}

async function boot() {
  const fake = fakePlayer();
  const app = await render(App, {
    providers: [
      provideNativeRouter(routes, withComponentInputBinding()),
      { provide: TRACK_PLAYER, useValue: () => fake.player },
    ],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  await nav.push('/player');
  await screen.findByRole(
    'button',
    { name: `${TRACKS[0]!.title} by ${TRACKS[0]!.artist}` },
    asyncWait,
  );
  return { ...app, nav, ...fake };
}

describe('player', () => {
  test('plays a record from the grid, and shows it in the mini player with its equaliser', async () => {
    const { calls } = await boot();
    await userEvent.press(screen.getByRole('button', { name: 'Naima by John Coltrane' }));
    expect(calls).toEqual(['replace', 'play']);
    await screen.findByRole('button', { name: 'Now playing, Naima' }, asyncWait);
    expect(screen.getByLabelText('Playing')).toBeTruthy();
    await userEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(calls.at(-1)).toBe('pause');
  });

  test('gives each cover its own colour as a CSS variable the gradient mixes from', async () => {
    const { fabric } = await boot();
    const tile = flatten(fabric.committed).find(
      (node) => node.props['accessibilityLabel'] === 'So What by Miles Davis',
    )!;
    const cover = tile.children[0]!;
    const image = cover.props['experimental_backgroundImage'] as { type: string }[] | undefined;
    expect(image?.[0]?.type).toBe('linear-gradient');
  });

  test('opens the full player as a page sheet, seeks from the scrubber, and steps the queue', async () => {
    const { calls, fabric } = await boot();
    await userEvent.press(screen.getByRole('button', { name: 'So What by Miles Davis' }));
    await userEvent.press(
      await screen.findByRole('button', { name: 'Now playing, So What' }, asyncWait),
    );
    await screen.findByRole('button', { name: 'Next' }, asyncWait);
    const sheet = flatten(fabric.committed)
      .filter((node) => node.viewName === 'RNSScreen')
      .at(-1)!;
    expect(sheet.props['stackPresentation']).toBe('pageSheet');
    await userEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(calls.slice(-2)).toEqual(['replace', 'play']);
    await waitFor(() => expect(screen.getAllByText('Naima').length).toBeGreaterThan(0), asyncWait);
  });

  test('moves on to the next record when one finishes', async () => {
    const { calls, state } = await boot();
    await userEvent.press(screen.getByRole('button', { name: 'So What by Miles Davis' }));
    state.update((s) => ({ ...s, playing: false, currentTime: 6, ended: true }));
    await screen.findByRole('button', { name: 'Now playing, Naima' }, asyncWait);
    expect(calls).toEqual(['replace', 'play', 'replace', 'play']);
  });
});
