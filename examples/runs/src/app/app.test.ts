import { Router, withComponentInputBinding } from '@angular/router';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import { cleanup, render, screen, userEvent, waitFor, within } from '@ng-native/testing';
import { afterEach, expect, test } from 'vitest';
import { App } from './app.ts';
import { routes } from './app.routes.ts';
import { SIMULATED_LOCATION_INTERVAL } from './tracking/simulated-location-source.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

// This config does not set Vitest's `globals: true`, so `@ng-native/testing` cannot install its
// own `afterEach`. Without it, a run left recording between tests keeps its simulated fixes
// ticking in the background - unmounting is what stops them.
afterEach(cleanup);

// Same router features as app.config.ts, plus a fast simulated location interval: the source is
// real, only made quick, so a test spends milliseconds rather than minutes watching a run move.
const start = () =>
  render(App, {
    providers: [
      provideNativeRouter(routes, withComponentInputBinding()),
      { provide: SIMULATED_LOCATION_INTERVAL, useValue: 4 },
    ],
  });

/** Waits for the elapsed-time stat to read something other than the start value. */
async function waitForProgress() {
  await waitFor(
    () => {
      expect(within(screen.getByTestId('elapsed')).queryByText('0:00')).toBeNull();
    },
    { timeout: 3_000 },
  );
}

test('the run screen opens on the run tab, idle, with an empty clock', async () => {
  await start();

  expect(await screen.findByTestId('elapsed', undefined, asyncWait)).toBeTruthy();
  expect(within(screen.getByTestId('elapsed')).getByText('0:00')).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Start run' }, asyncWait)).toBeTruthy();
});

test('starting a run moves the stats as the simulated route plays', async () => {
  await start();

  await userEvent.press(await screen.findByRole('button', { name: 'Start run' }, asyncWait));

  await waitForProgress();
  expect(await screen.findByRole('button', { name: 'Pause run' }, asyncWait)).toBeTruthy();
});

test('pausing a run holds the stats, and resuming continues them', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Start run' }, asyncWait));
  await waitForProgress();

  await userEvent.press(await screen.findByRole('button', { name: 'Pause run' }, asyncWait));
  const pausedElapsed = screen.getByTestId('elapsed').children;

  // Held for a moment: nothing arrives from the source while paused, so nothing changes.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByTestId('elapsed').children).toEqual(pausedElapsed);

  await userEvent.press(await screen.findByRole('button', { name: 'Resume run' }, asyncWait));
  expect(await screen.findByRole('button', { name: 'Pause run' }, asyncWait)).toBeTruthy();
});

test('finishing a run pushes its detail screen, with a GPX export button', async () => {
  const { componentRef } = await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Start run' }, asyncWait));
  await waitForProgress();

  await userEvent.press(await screen.findByRole('button', { name: 'Finish run' }, asyncWait));

  expect(await screen.findByRole('button', { name: 'Export as GPX' }, asyncWait)).toBeTruthy();

  componentRef.injector.get(NativeNavigation).back();
  expect(await screen.findByRole('button', { name: 'Start run' }, asyncWait)).toBeTruthy();
});

test('a finished run appears at the top of History', async () => {
  const { componentRef } = await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Start run' }, asyncWait));
  await waitForProgress();
  await userEvent.press(await screen.findByRole('button', { name: 'Finish run' }, asyncWait));
  // The push onto the detail screen is fire-and-forget from `finishRun()`; wait for the Router's
  // own state to catch up, not just the commit, or the navigations below can race it.
  const router = componentRef.injector.get(Router);
  await waitFor(() => expect(router.url).toMatch(/^\/runs\//), asyncWait);
  componentRef.injector.get(NativeNavigation).back();
  await waitFor(() => expect(router.url).not.toMatch(/^\/runs\//), asyncWait);

  await router.navigateByUrl('/history');
  await waitFor(() => expect(router.url).toBe('/history'), asyncWait);

  // The seeded runs, plus the one just finished. `waitFor` retries the whole assertion, so it
  // does not settle for whatever the tree happens to hold on the first, possibly stale, attempt.
  await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(5), {
    timeout: 2_000,
  });
});

test('History lists the seeded runs from a fresh launch', async () => {
  const { componentRef } = await start();

  await componentRef.injector.get(Router).navigateByUrl('/history');

  expect((await screen.findAllByText(/splits/, undefined, asyncWait)).length).toBeGreaterThan(0);
});

test('switching units in Settings changes how distance is shown on Run', async () => {
  const { componentRef } = await start();

  await componentRef.injector.get(Router).navigateByUrl('/settings');
  await userEvent.press(await screen.findByRole('button', { name: 'mi' }, asyncWait));
  await componentRef.injector.get(Router).navigateByUrl('/run');

  await waitFor(
    () => expect(within(screen.getByTestId('unit')).getByText('mi')).toBeTruthy(),
    asyncWait,
  );
});
