import { withComponentInputBinding } from '@angular/router';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import { render, screen, userEvent, waitFor, type FakeFabricNode } from '@ng-native/testing';
import { describe, expect, test, vi } from 'vitest';
import { App } from '../app.ts';
import { routes } from '../app.routes.ts';
import {
  OPTIONS,
  PICKUP,
  drivers,
  fare,
  formatFare,
  kilometres,
  searchPlaces,
} from './ride-model.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('ride fares and places', () => {
  test('measures a trip in kilometres and prices it to the penny', () => {
    const km = kilometres(PICKUP, { latitude: 51.5076, longitude: -0.0994 });
    expect(km).toBeCloseTo(3.07, 1);
    expect(fare(OPTIONS[0]!, 3)).toBe(6.1);
    expect(formatFare(6.1)).toBe('£6.10');
  });

  test('finds places by every word of the query, in name or area', () => {
    expect(searchPlaces('').length).toBeGreaterThan(10);
    expect(searchPlaces('tate').map((place) => place.name)).toEqual(['Tate Modern']);
    expect(searchPlaces('southwark borough').map((place) => place.name)).toEqual([
      'Borough Market',
    ]);
    expect(searchPlaces('nowhere')).toEqual([]);
  });

  test('moves the drivers a little every tick, around the pickup', () => {
    const [before] = drivers(0);
    const [after] = drivers(1);
    expect(after!.coordinates).not.toEqual(before!.coordinates);
    expect(kilometres(PICKUP, after!.coordinates)).toBeLessThan(2);
  });
});

async function boot() {
  const app = await render(App, {
    providers: [provideNativeRouter(routes, withComponentInputBinding())],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  await nav.push('/ride');
  await screen.findByRole('button', { name: 'Where to?' }, asyncWait);
  return { ...app, nav };
}

describe('ride', () => {
  test('opens the sheet with detents, leaving the map usable under the smallest', async () => {
    const { fabric } = await boot();
    await userEvent.press(screen.getByRole('button', { name: 'Where to?' }));
    await screen.findByLabelText('Search destinations', undefined, asyncWait);
    const sheet = flatten(fabric.committed)
      .filter((node) => node.viewName === 'RNSScreen')
      .at(-1)!;
    expect(sheet.props['sheetAllowedDetents']).toEqual([0.35, 0.6, 1]);
    expect(sheet.props['sheetLargestUndimmedDetent']).toBe(0);
  });

  test('chooses a destination, draws the route, and prices every kind of ride', async () => {
    const { fabric } = await boot();
    await userEvent.press(screen.getByRole('button', { name: 'Where to?' }));
    await userEvent.type(
      await screen.findByLabelText('Search destinations', undefined, asyncWait),
      'tate',
    );
    await userEvent.press(
      await screen.findByRole('button', { name: 'Tate Modern, Bankside' }, asyncWait),
    );
    await screen.findByRole('radio', { name: /^Economy, £/ }, asyncWait);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    const map = flatten(fabric.committed).find((node) => 'markers' in node.props)!;
    expect(map.props['polylines']).toHaveLength(1);
  });

  test('requests a ride, finds a driver, and cancels back to the map', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await boot();
      await userEvent.press(screen.getByRole('button', { name: 'Where to?' }));
      await userEvent.press(
        await screen.findByRole('button', { name: 'Borough Market, Southwark' }, asyncWait),
      );
      await userEvent.press(await screen.findByRole('radio', { name: /^Comfort/ }, asyncWait));
      await userEvent.press(screen.getByRole('button', { name: 'Request Comfort' }));
      await screen.findByText('Finding a driver', undefined, asyncWait);
      await vi.advanceTimersByTimeAsync(2100);
      await screen.findByText(/is on the way$/, undefined, asyncWait);
      await userEvent.press(screen.getByRole('button', { name: 'Cancel ride' }));
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'Where to?' })).toBeTruthy(),
        asyncWait,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
