import { Router, withComponentInputBinding } from '@angular/router';
import { DeepLinks, Dialogs, type NativeDialogs } from '@ng-native/device';
import { NativeNavigation, provideNativeRouter, withLinkParent } from '@ng-native/router';
import {
  fireEvent,
  render,
  screen,
  settle,
  userEvent,
  waitFor,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import { App } from '../app.ts';
import { routes } from '../app.routes.ts';
import { ProjectServer, ProjectStore } from './project-data.ts';
import { projectLinkParent } from './project-links.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function idle(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) await settle();
}

/** Each screen on the stack, bottom first, by the first text it shows. */
const screens = (fabric: FakeFabric) =>
  flatten(fabric.committed)
    .filter((node) => node.viewName === 'RNSScreen')
    .map((node) => node);

async function boot(options: { launch?: string; answers?: boolean[] } = {}) {
  const server = new ProjectServer();
  server.latency = 0;
  const asked: string[] = [];
  const answers = [...(options.answers ?? [])];
  const dialogs: NativeDialogs = {
    platform: 'ios',
    alert: (title, _message, buttons) => {
      asked.push(title);
      const agree = answers.shift() ?? true;
      buttons
        .find((button) => (agree ? button.style !== 'cancel' : button.style === 'cancel'))
        ?.onPress?.();
    },
  };
  const app = await render(App, {
    providers: [
      provideNativeRouter(routes, withComponentInputBinding(), withLinkParent(projectLinkParent)),
      { provide: ProjectServer, useValue: server },
      { provide: Dialogs.SOURCE, useValue: dialogs },
      {
        provide: DeepLinks.SOURCE,
        useValue: {
          launchUrl: () => Promise.resolve(options.launch ? `canary:/${options.launch}` : null),
          subscribe: () => () => {},
          open: () => {},
        },
      },
    ],
  });
  await idle();
  const injector = app.componentRef.injector;
  return {
    ...app,
    server,
    asked,
    store: injector.get(ProjectStore),
    router: injector.get(Router),
    nav: injector.get(NativeNavigation),
  };
}

describe('task manager', () => {
  test('goes six screens deep and pops back to the list in one go', async () => {
    const { nav, router, fabric } = await boot();
    for (const url of [
      '/projects',
      '/projects/p1',
      '/projects/p1/tasks/t2',
      '/projects/p1/tasks/t2/comments/c5',
      '/people/alan',
      '/projects/p2/tasks/t43',
    ]) {
      await nav.push(url);
      await idle();
    }
    expect(screens(fabric)).toHaveLength(7);
    expect(await nav.popTo('/projects')).toBe(true);
    await idle();
    expect(router.url).toBe('/projects');
    expect(screens(fabric)).toHaveLength(2);
  });

  test('opens a deep link to a comment on the task, the project and the list beneath it', async () => {
    const { router, fabric, nav } = await boot({ launch: '/projects/p1/tasks/t2/comments/c5' });
    await idle();
    expect(router.url).toBe('/projects/p1/tasks/t2/comments/c5');
    expect(screens(fabric)).toHaveLength(5);
    nav.back();
    await idle();
    expect(router.url).toBe('/projects/p1/tasks/t2');
  });

  test('saves an edit made in the sheet, and every screen shows it', async () => {
    const { nav, store } = await boot();
    await nav.push('/projects/p1');
    await idle();
    await nav.push('/projects/p1/tasks/t2');
    await idle();
    await userEvent.press(screen.getByRole('button', { name: 'Edit' }));
    const title = await screen.findByLabelText('Title', undefined, asyncWait);
    await userEvent.clear(title);
    await userEvent.type(title, 'Ship the beta');
    await userEvent.press(screen.getByRole('button', { name: 'Save' }));
    await idle();
    expect(store.task('t2')?.title).toBe('Ship the beta');
    expect(screen.getAllByText('Ship the beta').length).toBeGreaterThan(0);
  });

  test('refuses a swipe down while the sheet holds changes, and asks before discarding', async () => {
    const { nav, fabric, asked, store } = await boot({ answers: [false, true] });
    await nav.push('/projects/p1/tasks/t2');
    await idle();
    await userEvent.press(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByLabelText('Title', undefined, asyncWait);
    const sheet = () => screens(fabric).at(-1)!;
    expect(sheet().props['preventNativeDismiss']).toBe(false);
    await userEvent.type(screen.getByLabelText('Title'), '!');
    expect(sheet().props['preventNativeDismiss']).toBe(true);

    // A swipe down, refused by native, then "Keep editing".
    await fireEvent(sheet(), 'nativeDismissCancelled', {});
    await idle();
    expect(asked).toEqual(['Discard your changes?']);
    expect(screens(fabric)).toHaveLength(3);

    // Again, then "Discard": the sheet goes and the task is as it was.
    const before = store.task('t2')!.title;
    await fireEvent(sheet(), 'nativeDismissCancelled', {});
    await idle();
    expect(screens(fabric)).toHaveLength(2);
    expect(store.task('t2')!.title).toBe(before);
  });

  test('deletes after asking, and leaves the task s screen', async () => {
    const { nav, store, router } = await boot();
    await nav.push('/projects/p1');
    await idle();
    await nav.push('/projects/p1/tasks/t2');
    await idle();
    await userEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await idle();
    expect(store.task('t2')).toBeUndefined();
    expect(router.url).toBe('/projects/p1');
  });

  test('puts a toggle back when the server refuses it, and says so', async () => {
    const { store, server } = await boot();
    await store.load();
    const done = store.task('t2')!.done;
    server.offline = true;
    store.toggleDone('t2');
    expect(store.task('t2')!.done).toBe(!done);
    await waitFor(() => expect(store.task('t2')!.done).toBe(done), asyncWait);
    expect(store.notice()).toBe('Could not save the task');
  });

  test('keeps a change still on its way to the server through a refresh', async () => {
    const { store, server } = await boot();
    await store.load();
    server.latency = 30;
    store.toggleDone('t3');
    const toggled = store.task('t3')!.done;
    server.latency = 0;
    await store.load();
    expect(store.task('t3')!.done).toBe(toggled);
  });

  test('shows what someone else changed once refreshed, on every screen', async () => {
    const { nav } = await boot();
    await nav.push('/projects/p1/tasks/t2');
    await idle();
    await userEvent.press(
      screen.getByRole('button', { name: 'Have Grace rename it, then refresh' }),
    );
    await idle();
    expect(screen.getAllByText(/\(edited by Grace\)/).length).toBeGreaterThan(0);
  });
});
