import { Network, type NetworkStatus } from '@ng-native/expo/network';
import { NativeNavigation } from '@ng-native/router';
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { FakeNotesApi, NOTES_API } from './api/notes-api.ts';
import { App } from './app.ts';
import { appConfig } from './app.config.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

/** A `Network.SOURCE` a test can flip between offline and online. */
function controllableNetwork(initial: NetworkStatus) {
  let current = initial;
  let listener: ((status: NetworkStatus) => void) | null = null;
  return {
    source: {
      current: async () => current,
      subscribe: (next: (status: NetworkStatus) => void) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    },
    goOnline: () => {
      current = { connected: true, type: 'wifi', reachable: true };
      listener?.(current);
    },
  };
}

function start(networkSource: ReturnType<typeof controllableNetwork>['source']) {
  return render(App, {
    providers: [
      ...appConfig.providers,
      { provide: NOTES_API, useValue: new FakeNotesApi([], { latencyMs: 0, failureRate: 0 }) },
      { provide: Network.SOURCE, useValue: networkSource },
    ],
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

test('creates a note offline, and it syncs once back online', async () => {
  const network = controllableNetwork({ connected: false, type: 'none', reachable: false });
  const { componentRef } = await start(network.source);

  expect(await screen.findByText('Offline', undefined, asyncWait)).toBeTruthy();

  await userEvent.press(await screen.findByRole('button', { name: 'New note' }, asyncWait));

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Title', undefined, asyncWait), 'Groceries');
  await user.type(screen.getByLabelText('Note body'), 'Milk, eggs, bread');
  await settle(); // the autosave debounce

  componentRef.injector.get(NativeNavigation).back();
  expect(await screen.findByText('Offline', undefined, asyncWait)).toBeTruthy();
  expect(await screen.findByText('Groceries', undefined, asyncWait)).toBeTruthy();

  network.goOnline();
  expect(await screen.findByText('Synced', undefined, asyncWait)).toBeTruthy();
});
