import { withComponentInputBinding } from '@angular/router';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import { render, screen, userEvent, type ByRoleOptions } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';
import { routes } from './app.routes.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

const start = () =>
  render(App, { providers: [provideNativeRouter(routes, withComponentInputBinding())] });

/** `accessibilityState` is untyped on a fake node's props; read it back through one shape. */
function stateOf(node: { props: Record<string, unknown> }) {
  return (node.props['accessibilityState'] ?? {}) as { checked?: boolean; disabled?: boolean };
}

const checkbox = (name: ByRoleOptions['name']) =>
  screen.findByRole('checkbox', { name }, asyncWait);

test('checks a habit off, and its streak grows', async () => {
  await start();
  expect(stateOf(await checkbox('Exercise')).checked).toBe(false);

  await userEvent.press(await checkbox('Exercise'));

  expect(stateOf(await checkbox('Exercise')).checked).toBe(true);
  expect(await screen.findByText('7 days', undefined, asyncWait)).toBeTruthy();
});

test('unchecking a habit undoes it', async () => {
  await start();
  expect(stateOf(await checkbox('Drink water')).checked).toBe(true);

  await userEvent.press(await checkbox('Drink water'));

  expect(stateOf(await checkbox('Drink water')).checked).toBe(false);
});

test('creates a habit through the form, and it shows up on Today', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'New habit' }, asyncWait));

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Habit name', undefined, asyncWait), 'Stretch');
  await user.press(screen.getByLabelText('Colour #0ea5e9'));
  await user.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Stretch', undefined, asyncWait)).toBeTruthy();
  expect(stateOf(await checkbox('Stretch')).checked).toBe(false);
});

test('a habit needs a name, and two habits cannot share one', async () => {
  await start();
  await userEvent.press(await screen.findByRole('button', { name: 'New habit' }, asyncWait));

  const save = await screen.findByRole('button', { name: 'Save' }, asyncWait);
  expect(stateOf(save).disabled).toBe(true);

  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Habit name', undefined, asyncWait), 'Exercise');

  expect(
    await screen.findByText('Already tracking a habit with this name', undefined, asyncWait),
  ).toBeTruthy();
});

test('opening a habit shows its streak, and back returns to Today', async () => {
  const { componentRef } = await start();
  await userEvent.press(await screen.findByRole('button', { name: 'Read' }, asyncWait));

  expect(await screen.findByText('Last 10 weeks', undefined, asyncWait)).toBeTruthy();

  componentRef.injector.get(NativeNavigation).back();

  expect(await checkbox('Read')).toBeTruthy();
});
