import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import { Router, withComponentInputBinding } from '@angular/router';
import { fireEvent, render, screen, userEvent, within } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';
import { routes } from './app.routes.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

// The same router features as index.ts: the payment screen's `id` arrives as an input.
const start = () =>
  render(App, { providers: [provideNativeRouter(routes, withComponentInputBinding())] });

test('hides the balance when the card is tapped', async () => {
  await start();
  const card = await screen.findByRole('button', { name: 'Hide balance' }, asyncWait);

  await userEvent.press(card);

  expect(screen.getByText('£ ••••••')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show balance' })).toBeTruthy();
});

test('sends money, and the payment is the first thing on the home screen', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Send money' }, asyncWait));

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Recipient', undefined, asyncWait), 'Grace Hopper');
  await user.type(screen.getByLabelText('Amount'), '12.50');
  await user.press(screen.getByRole('button', { name: 'Send £12.50' }));

  expect(await screen.findByText('Grace Hopper', undefined, asyncWait)).toBeTruthy();
  expect(screen.getByText('- £12.50')).toBeTruthy();
});

test('will not send more than the balance', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Send money' }, asyncWait));

  await userEvent.type(await screen.findByLabelText('Amount', undefined, asyncWait), '999999');

  expect(screen.getByText('More than you have')).toBeTruthy();
});

test('searches the activity list from the navigation bar', async () => {
  await start();
  await userEvent.press(await screen.findByRole('link', { name: 'See all' }, asyncWait));
  const search = await screen.findByTestId('search', undefined, asyncWait);
  // The home tab is still mounted behind this one, with payments of its own.
  const list = within(screen.getByTestId('payments'));
  expect(list.queryAllByText('Pret').length).toBeGreaterThan(0);

  await userEvent.type(search, 'spotify');

  expect(list.queryAllByText('Spotify').length).toBeGreaterThan(0);
  expect(list.queryAllByText('Pret')).toHaveLength(0);
});

test('hiding the balance in settings hides it on the home screen', async () => {
  const { componentRef } = await start();
  await screen.findByRole('button', { name: 'Hide balance' }, asyncWait);
  await componentRef.injector.get(Router).navigateByUrl('/settings');

  await fireEvent(
    await screen.findByRole('switch', { name: 'Hide balance' }, asyncWait),
    'change',
    {
      value: true,
    },
  );
  await componentRef.injector.get(Router).navigateByUrl('/home');

  expect(await screen.findByText('£ ••••••', undefined, asyncWait)).toBeTruthy();
});

test('a payment opened from home goes back to home, and the activity list still opens one', async () => {
  const { componentRef } = await start();
  const recent = await screen.findAllByRole('button', { name: /Blue Bottle/ }, asyncWait);
  await userEvent.press(recent[0]!);
  expect(await screen.findByText('Category', undefined, asyncWait)).toBeTruthy();

  componentRef.injector.get(NativeNavigation).back();
  await userEvent.press(await screen.findByRole('link', { name: 'See all' }, asyncWait));
  const list = within(await screen.findByTestId('payments', undefined, asyncWait));
  await userEvent.press(list.getAllByRole('button', { name: /Dishoom/ })[0]!);

  expect(await screen.findByText('Eating out', undefined, asyncWait)).toBeTruthy();
  expect(screen.getAllByText('Category')).toHaveLength(1);
});
