import { describe, expect, it } from 'vitest';
import { href, parseRoute } from './router';

describe('parseRoute', () => {
  it('treats an empty or root fragment as the overview', () => {
    expect(parseRoute('')).toEqual({ name: 'overview' });
    expect(parseRoute('#')).toEqual({ name: 'overview' });
    expect(parseRoute('#/')).toEqual({ name: 'overview' });
  });

  it('parses each top-level page', () => {
    expect(parseRoute('#/scripts')).toEqual({ name: 'scripts', scriptId: null });
    expect(parseRoute('#/runs').name).toBe('runs');
    expect(parseRoute('#/targets')).toEqual({ name: 'targets' });
    expect(parseRoute('#/sources')).toEqual({ name: 'sources' });
  });

  it('carries the id of a detail route', () => {
    const scripts = parseRoute('#/scripts/sc-1');
    expect(scripts).toMatchObject({ name: 'scripts', scriptId: 'sc-1' });

    const run = parseRoute('#/runs/ex-77f3a1');
    expect(run).toMatchObject({ name: 'runs', executionId: 'ex-77f3a1' });
  });

  it('decodes an id that had to be percent-encoded', () => {
    // Execution ids are opaque; one containing a slash must survive a round trip
    // without being mistaken for a second path segment.
    const route = parseRoute('#/runs/ex%2Fodd%20id');
    expect(route).toMatchObject({ name: 'runs', executionId: 'ex/odd id' });
  });

  it('ignores a trailing slash', () => {
    expect(parseRoute('#/targets/').name).toBe('targets');
    expect(parseRoute('#/scripts/')).toEqual({ name: 'scripts', scriptId: null });
  });

  it('reports an unknown path rather than silently falling back', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'notFound', path: '/nope' });
    expect(parseRoute('#/runs/extra/segments').name).toBe('runs');
  });

  it('exposes the query string of the runs page', () => {
    const route = parseRoute('#/runs?status=failed&page=2');
    expect(route.name).toBe('runs');
    if (route.name !== 'runs') throw new Error('expected a runs route');
    expect(route.search.get('status')).toBe('failed');
    expect(route.search.get('page')).toBe('2');
  });
});

describe('href', () => {
  it('builds a fragment from a bare path', () => {
    expect(href('/')).toBe('#/');
    expect(href('targets')).toBe('#/targets');
  });

  it('drops empty and undefined filters instead of writing blank params', () => {
    expect(href('/runs', { status: 'failed', scriptId: undefined, targetId: '' })).toBe(
      '#/runs?status=failed',
    );
  });

  it('keeps numbers', () => {
    expect(href('/runs', { page: 3 })).toBe('#/runs?page=3');
  });

  it('round-trips through parseRoute', () => {
    const built = href('/runs', { status: 'failed', scriptId: 'sc-1', page: 2 });
    const route = parseRoute(built);
    if (route.name !== 'runs') throw new Error('expected a runs route');
    expect(route.search.get('status')).toBe('failed');
    expect(route.search.get('scriptId')).toBe('sc-1');
    expect(route.search.get('page')).toBe('2');
  });
});
