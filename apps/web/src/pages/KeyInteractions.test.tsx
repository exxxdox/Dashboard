import type { ReactElement } from 'react';
import type { ExecutionSummary, ScriptRunPrefill, ScriptSummary, TargetSummary } from '@dashboard/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SignInPage } from './SignInPage';
import { TargetForm } from './TargetForm';
import { RunDetailPage } from './RunDetailPage';
import { RunNowButton } from './RunNowButton';

// Exercise the real event handlers without adding a browser renderer dependency.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], index: 0,
  effects: [] as (() => (() => void) | void)[],
  login: { mutate: vi.fn(), isPending: false, isError: false, error: null as Error | null },
  create: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
  cancel: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
  execute: { mutate: vi.fn(), isPending: false },
  execution: { data: undefined as ExecutionSummary | undefined, isError: false, error: null as Error | null, refetch: vi.fn() },
  targets: [] as TargetSummary[],
  prefill: { data: undefined as ScriptRunPrefill | undefined, isSuccess: false },
  apply: vi.fn(), navigate: vi.fn(), goBack: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next;
    }];
  },
  useEffect: (effect: () => (() => void) | void) => { hooks.effects.push(effect); },
}));
vi.mock('../api/queries', () => ({
  useLogin: () => hooks.login,
  useCreateTarget: () => hooks.create,
  useUpdateTarget: () => hooks.update,
  useCancelExecution: () => hooks.cancel,
  useDeleteExecution: () => hooks.remove,
  useExecuteScript: () => hooks.execute,
  useExecution: () => hooks.execution,
  useApplyExecutionUpdate: () => hooks.apply,
  useTargets: () => ({ data: hooks.targets }),
  useScriptRunDraft: () => hooks.prefill,
}));
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }) }));
vi.mock('../lib/router', () => ({ navigate: hooks.navigate, goBack: hooks.goBack }));

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render(component: () => Element): Element {
  hooks.index = 0;
  hooks.effects = [];
  return component();
}
function field(tree: Element, label: string): Element {
  const row = elements(tree).find((element) => element.props.label === label)!;
  return (row.props.children as (props: { id: string }) => Element)({ id: label });
}
function edit(tree: Element, label: string, value: string): void {
  (field(tree, label).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}
function submit(tree: Element): void {
  const form = elements(tree).find((element) => element.type === 'form')!;
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
}
function button(tree: Element, label: string): Element | undefined {
  return elements(tree).find((element) => element.props.children === label && typeof element.props.onClick === 'function');
}
function click(element: Element): void { (element.props.onClick as () => void)(); }

const target: TargetSummary = {
  id: 'target', name: 'host', host: 'example.test', port: 22, username: 'ops', authMethod: 'key',
  workDir: '/work', connectTimeoutSec: 15, createdAt: '', updatedAt: '',
  lastCheckAt: null, lastCheckOk: null, lastCheckDetail: null,
};
const script: ScriptSummary = {
  id: 'script', sourceId: 'source', relPath: 'run.sh', relDir: '', fileName: 'run.sh', format: 'sh',
  sizeBytes: 20, contentHash: 'hash', displayName: 'run', description: null, params: [],
  timeoutSec: null, interpreterOverride: null, discoveredAt: '', updatedAt: '',
};
function run(status: ExecutionSummary['status']): ExecutionSummary {
  return {
    id: 'run', scheduleId: null, scheduleName: null, scriptId: 'script', targetId: 'target', status, exitCode: null, signal: null,
    commandDisplay: 'sh run.sh', targetName: 'host', scriptName: 'run', scriptRelPath: 'run.sh',
    paramValues: {}, argv: [], queuedAt: '2026-01-01T00:00:00Z', startedAt: null, finishedAt: null,
    durationMs: null, logBytes: 0, truncated: false, errorMessage: null,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  hooks.slots = []; hooks.index = 0; hooks.effects = [];
  hooks.login.isPending = false; hooks.login.isError = false; hooks.login.error = null;
  hooks.execution.data = undefined; hooks.execution.isError = false; hooks.execution.error = null;
  hooks.targets = [target];
  hooks.prefill = { data: { source: 'draft', draft: { params: {}, custom: [], timeoutSec: '' } }, isSuccess: true };
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('HTMLElement', class {});
});
afterEach(() => vi.unstubAllGlobals());

describe('sign in', () => {
  test('refuses incomplete credentials and submits the values actually typed', () => {
    submit(render(SignInPage));
    expect(hooks.login.mutate).not.toHaveBeenCalled();
    edit(render(SignInPage), 'auth.username', 'ops');
    submit(render(SignInPage));
    expect(hooks.login.mutate).not.toHaveBeenCalled();
    edit(render(SignInPage), 'auth.password', ' secret ');
    submit(render(SignInPage));
    expect(hooks.login.mutate).toHaveBeenCalledWith({ username: 'ops', password: ' secret ' });
  });
  test('exposes server errors and pending state without dropping input', () => {
    edit(render(SignInPage), 'auth.username', 'ops');
    edit(render(SignInPage), 'auth.password', 'secret');
    hooks.login.isError = true; hooks.login.error = new Error('Sign in refused'); hooks.login.isPending = true;
    const tree = render(SignInPage);
    expect(elements(tree).some((element) => element.props.message === 'Sign in refused')).toBe(true);
    expect(elements(tree).find((element) => element.props.type === 'submit')?.props.loading).toBe(true);
    expect(field(tree, 'auth.password').props.value).toBe('secret');
  });
});

describe('target form', () => {
  function form(existing: TargetSummary | null = null, onDone = vi.fn()): Element {
    return render(() => TargetForm({ target: existing, onDone }));
  }
  function fill(): void {
    for (const [label, value] of Object.entries({ name: ' host ', host: ' example.test ', username: ' ops ', workDir: ' /work ' })) {
      edit(form(), `targets.form.${label}`, value);
    }
  }
  test('requires connection fields and a credential for a new target', () => {
    submit(form());
    expect(hooks.create.mutate).not.toHaveBeenCalled();
    expect(elements(form()).filter((element) => element.props.error === 'targets.form.required')).toHaveLength(5);
    fill(); submit(form());
    expect(hooks.create.mutate).not.toHaveBeenCalled();
  });
  test('creates a key target, trims connection fields and preserves secret bytes', () => {
    const done = vi.fn();
    fill();
    edit(form(), 'targets.form.privateKey', ' key\n');
    edit(form(), 'targets.form.passphrase', ' phrase ');
    submit(form(null, done));
    expect(hooks.create.mutate).toHaveBeenCalledWith({
      name: 'host', host: 'example.test', username: 'ops', port: 22, workDir: '/work', connectTimeoutSec: 15,
      auth: { method: 'key', privateKey: ' key\n', passphrase: ' phrase ' },
    }, { onSuccess: done });
  });
  test('creates password authentication and allows cancel without a request', () => {
    const done = vi.fn();
    fill(); edit(form(), 'targets.form.auth', 'password');
    edit(form(), 'targets.form.password', ' password ');
    submit(form(null, done));
    expect(hooks.create.mutate.mock.calls[0]?.[0].auth).toEqual({ method: 'password', password: ' password ' });
    click(button(form(null, done), 'targets.form.cancel')!);
    expect(done).toHaveBeenCalledOnce();
  });
  test.each(['key', 'password'] as const)('an edit with blank %s credentials keeps the stored secret', (authMethod) => {
    const existing = { ...target, authMethod };
    submit(form(existing));
    expect(hooks.update.mutate).toHaveBeenCalledWith({ id: 'target', input: {
      name: 'host', host: 'example.test', username: 'ops', port: 22, workDir: '/work', connectTimeoutSec: 15,
    } }, expect.any(Object));
    expect(hooks.create.mutate).not.toHaveBeenCalled();
  });
  test('an edit can replace a key without inventing a passphrase', () => {
    edit(form(target), 'targets.form.privateKey', 'replacement key');
    edit(form(target), 'targets.form.port', '2222');
    edit(form(target), 'targets.form.connectTimeout', '30');
    submit(form(target));
    expect(hooks.update.mutate.mock.calls[0]?.[0].input).toMatchObject({
      port: 2222, connectTimeoutSec: 30, auth: { method: 'key', privateKey: 'replacement key' },
    });
    expect(hooks.update.mutate.mock.calls[0]?.[0].input.auth).not.toHaveProperty('passphrase');
  });
  test('an edit can replace the auth method and credential', () => {
    edit(form(target), 'targets.form.auth', 'password');
    edit(form(target), 'targets.form.password', 'replacement');
    submit(form(target));
    expect(hooks.update.mutate.mock.calls[0]?.[0].input.auth).toEqual({ method: 'password', password: 'replacement' });
  });
});

describe('one-click run', () => {
  function renderButton(selected = script, onNeedSettings = vi.fn()): Element {
    return render(() => RunNowButton({ script: selected, onNeedSettings }));
  }
  test('waits for saved settings and a target', () => {
    hooks.prefill = { data: undefined, isSuccess: false };
    expect(renderButton().props.disabled).toBe(true);
    click(renderButton());
    expect(hooks.execute.mutate).not.toHaveBeenCalled();
    hooks.targets = [];
    hooks.prefill = { data: { source: 'draft', draft: { params: {}, custom: [], timeoutSec: '' } }, isSuccess: true };
    expect(renderButton().props.disabled).toBe(true);
    click(renderButton());
    expect(hooks.execute.mutate).not.toHaveBeenCalled();
  });
  test('submits stored params and positional args to the first target and navigates after success', () => {
    hooks.targets.push({ ...target, id: 'other' });
    hooks.prefill.data!.draft = { interactive: true, params: { NAME: 'saved' }, custom: [{ name: '标签', value: 'a b', mode: 'argv' }], timeoutSec: '30' };
    click(renderButton());
    expect(hooks.execute.mutate).toHaveBeenCalledWith({ scriptId: 'script', input: {
      targetId: 'target', interactive: true, params: { NAME: 'saved' }, argv: ['a b'], timeoutSec: 30,
    } }, expect.any(Object));
    hooks.execute.mutate.mock.calls[0]![1].onSuccess({ executionId: 'a/b' });
    expect(hooks.navigate).toHaveBeenCalledWith('/runs/a%2Fb');
  });
  test('opens settings when a newly required parameter is missing', () => {
    const needSettings = vi.fn();
    click(renderButton({ ...script, params: [{ name: 'NAME', type: 'string', default: null, required: true, description: '' }] }, needSettings));
    expect(needSettings).toHaveBeenCalledOnce();
    expect(hooks.execute.mutate).not.toHaveBeenCalled();
  });
  test('opens settings for invalid saved custom environment names', () => {
    hooks.prefill.data!.draft.custom = [{ name: 'BAD-NAME', value: 'value', mode: 'env' }];
    const needSettings = vi.fn();
    click(renderButton(script, needSettings));
    expect(needSettings).toHaveBeenCalledOnce();
    expect(hooks.execute.mutate).not.toHaveBeenCalled();
  });
});

describe('run details', () => {
  const detail = () => render(() => RunDetailPage({ executionId: 'run' }));
  test.each(['queued', 'running'] as const)('%s runs offer cancel, never delete', (status) => {
    hooks.execution.data = run(status);
    const tree = detail();
    expect(button(tree, 'runs.detail.delete')).toBeUndefined();
    click(button(tree, 'runs.detail.cancel')!);
    expect(hooks.cancel.mutate).toHaveBeenCalledWith('run');
    expect(hooks.remove.mutate).not.toHaveBeenCalled();
    expect(elements(tree).find((element) => element.props.executionId === 'run')?.props.live).toBe(true);
  });
  test.each(['succeeded', 'failed', 'canceled', 'timed_out', 'interrupted'] as const)('%s runs offer delete and use stored logs', (status) => {
    hooks.execution.data = run(status);
    const tree = detail();
    expect(button(tree, 'runs.detail.cancel')).toBeUndefined();
    click(button(tree, 'runs.detail.delete')!);
    expect(hooks.remove.mutate).toHaveBeenCalledWith('run', expect.any(Object));
    expect(hooks.navigate).not.toHaveBeenCalled();
    hooks.remove.mutate.mock.calls[0]![1].onSuccess();
    expect(hooks.navigate).toHaveBeenCalledWith('/runs', { replace: true });
    expect(elements(tree).find((element) => element.props.executionId === 'run')?.props.live).toBe(false);
  });
  test('Escape inside the terminal or an editor stays on the run page', () => {
    class InputTarget {
      tagName = 'TEXTAREA';
      isContentEditable = false;
    }
    vi.stubGlobal('HTMLElement', InputTarget);
    detail();
    const cleanup = hooks.effects[0]!();
    const key = (target: EventTarget | InputTarget | null, prevented = false) => {
      const event = new Event('keydown', { cancelable: true });
      Object.defineProperties(event, { key: { value: 'Escape' }, target: { value: target } });
      if (prevented) event.preventDefault();
      window.dispatchEvent(event);
    };
    key(new InputTarget());
    key(null, true);
    expect(hooks.goBack).not.toHaveBeenCalled();
    key(null);
    expect(hooks.goBack).toHaveBeenCalledWith('/runs');
    cleanup?.();
  });
  test('reports loading/errors, retries a failed fetch, and cleans up Escape navigation', () => {
    expect(elements(detail()).some((element) => element.props.label === 'runs.detail.loading')).toBe(true);
    hooks.execution.isError = true; hooks.execution.error = new Error('Run unavailable');
    const tree = detail();
    const banner = elements(tree).find((element) => element.props.message === 'Run unavailable')!;
    (banner.props.onRetry as () => void)();
    expect(hooks.execution.refetch).toHaveBeenCalledOnce();
    const cleanup = hooks.effects[0]!();
    const escape = new Event('keydown'); Object.defineProperty(escape, 'key', { value: 'Escape' });
    window.dispatchEvent(escape);
    expect(hooks.goBack).toHaveBeenCalledWith('/runs');
    cleanup?.(); hooks.goBack.mockClear(); window.dispatchEvent(escape);
    expect(hooks.goBack).not.toHaveBeenCalled();
  });
});
