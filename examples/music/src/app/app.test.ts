import { render, screen, userEvent, within } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';
import { appConfig } from './app.config.ts';
import { TRACK_PLAYER, fakeTrackPlayer } from './player/track-player.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

// The same providers main.ts hands `mount()`, with one override: `expo-audio` is not installed
// under Vitest, and `audioPlayer()` throws rather than doing nothing when it is missing (see
// player.ts), so the real player is swapped for a fake one that behaves the same way a test cares
// about - it just has no decoder behind it.
const start = () =>
  render(App, {
    providers: [...appConfig.providers, { provide: TRACK_PLAYER, useValue: fakeTrackPlayer }],
  });

test('opens an album and starts playback, which shows the mini player', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Drift' }, asyncWait));

  expect(await screen.findByText('Low Tide', undefined, asyncWait)).toBeTruthy();
  await userEvent.press(await screen.findByRole('button', { name: 'Play all' }, asyncWait));

  const miniPlayer = within(await screen.findByTestId('mini-player', undefined, asyncWait));
  expect(await miniPlayer.findByText('Low Tide', undefined, asyncWait)).toBeTruthy();
  expect(miniPlayer.getByRole('button', { name: 'Pause' })).toBeTruthy();
});

test('the mini player skips to the next track', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Drift' }, asyncWait));
  await userEvent.press(await screen.findByRole('button', { name: 'Play all' }, asyncWait));

  const miniPlayer = within(await screen.findByTestId('mini-player', undefined, asyncWait));
  await userEvent.press(miniPlayer.getByRole('button', { name: 'Next' }));

  expect(await miniPlayer.findByText('Open Water', undefined, asyncWait)).toBeTruthy();
});

test('tapping a track in the album plays from there, not from the top', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Drift' }, asyncWait));
  const albumTracks = within(await screen.findByTestId('album-tracks', undefined, asyncWait));
  await userEvent.press(albumTracks.getByRole('button', { name: /Undertow/ }));

  const miniPlayer = within(await screen.findByTestId('mini-player', undefined, asyncWait));
  expect(await miniPlayer.findByText('Undertow', undefined, asyncWait)).toBeTruthy();
});

test('the mini player opens Now Playing, with transport controls of its own', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Drift' }, asyncWait));
  await userEvent.press(await screen.findByRole('button', { name: 'Play all' }, asyncWait));
  await userEvent.press(
    await screen.findByRole('button', { name: 'Now playing: Low Tide' }, asyncWait),
  );

  const nowPlaying = within(await screen.findByTestId('now-playing', undefined, asyncWait));
  expect(await nowPlaying.findByText('Low Tide', undefined, asyncWait)).toBeTruthy();
  expect(nowPlaying.getByRole('button', { name: 'Pause' })).toBeTruthy();

  await userEvent.press(nowPlaying.getByRole('button', { name: 'Next' }));
  expect(await nowPlaying.findByText('Open Water', undefined, asyncWait)).toBeTruthy();

  await userEvent.press(nowPlaying.getByRole('button', { name: 'Close' }));
  expect(await screen.findByRole('button', { name: 'Play all' }, asyncWait)).toBeTruthy();
});

test('searching the library narrows the track list', async () => {
  await start();
  const search = await screen.findByTestId('search', undefined, asyncWait);
  const tracks = within(await screen.findByTestId('tracks', undefined, asyncWait));
  expect(tracks.queryAllByText('First Light').length).toBeGreaterThan(0);

  await userEvent.type(search, 'blue hour');

  expect(tracks.queryAllByText('Blue Hour').length).toBeGreaterThan(0);
  expect(tracks.queryAllByText('First Light')).toHaveLength(0);
});
