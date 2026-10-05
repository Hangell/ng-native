import { withComponentInputBinding } from '@angular/router';
import { ColorScheme } from '@ng-native/device';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import { fireEvent, render, screen, userEvent } from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import { App } from '../app.ts';
import { routes } from '../app.routes.ts';
import { search } from './settings-model.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

describe('the settings search', () => {
  test('finds rows by title and by the words they are known by', () => {
    expect(search('wi').map((row) => row.id)).toEqual(['wifi']);
    expect(search('dark mode').map((row) => row.id)).toEqual(['display']);
    expect(search('  ')).toEqual([]);
  });
});

async function boot(path: string, scheme: (string | null)[] = []) {
  const app = await render(App, {
    providers: [
      provideNativeRouter(routes, withComponentInputBinding()),
      {
        provide: ColorScheme.SOURCE,
        useValue: {
          current: () => 'light',
          subscribe: () => () => {},
          set: (s: string | null) => void scheme.push(s),
        },
      },
    ],
  });
  await app.componentRef.injector.get(NativeNavigation).push(path);
  return app;
}

describe('settings', () => {
  test('the Airplane Mode row switches, and Wi-Fi says it is off', async () => {
    await boot('/settings');
    const row = await screen.findByRole('switch', { name: 'Airplane Mode' }, asyncWait);
    expect(screen.getByLabelText('Wi-Fi, Morgan Home')).toBeTruthy();
    await userEvent.press(row);
    await screen.findByLabelText('Wi-Fi, Off', undefined, asyncWait);
    expect(
      screen.getByRole('switch', { name: 'Airplane Mode' }).props['accessibilityState'],
    ).toEqual({ checked: true });
  });

  test('picking Dark sets the whole app dark, and Automatic hands it back', async () => {
    const asked: (string | null)[] = [];
    await boot('/settings/display', asked);
    await userEvent.press(await screen.findByRole('radio', { name: 'Dark' }, asyncWait));
    expect(asked).toEqual(['dark']);
    await fireEvent(screen.getByRole('switch', { name: 'Automatic' }), 'change', { value: true });
    expect(asked).toEqual(['dark', null]);
  });

  test('Wi-Fi joins the network pressed', async () => {
    await boot('/settings/wifi');
    await userEvent.press(
      await screen.findByRole('button', { name: 'Cafe Nero Guest, 2 bars' }, asyncWait),
    );
    await screen.findByLabelText('Cafe Nero Guest, connected', undefined, asyncWait);
  });
});
