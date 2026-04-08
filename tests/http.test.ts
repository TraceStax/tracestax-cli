import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request } from '../src/http';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeOkResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ ok: true, data })),
    json: () => Promise.resolve({ ok: true, data }),
  };
}

function makeErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  };
}

describe('request()', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns data from a successful response', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 'ws_123' }));
    const result = await request('https://api.tracestax.com', '/v1/workspace', 'ts_test_key');
    expect(result).toEqual({ id: 'ws_123' });
  });

  it('builds the correct URL from endpoint + path', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    await request('https://api.tracestax.com', '/v1/workspace', 'ts_test_key');
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toBe('https://api.tracestax.com/v1/workspace');
  });

  it('includes the Authorization header with Bearer token', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    await request('https://api.tracestax.com', '/v1/workspace', 'ts_live_abc123');
    const calledOptions = mockFetch.mock.calls[0][1];
    expect(calledOptions.headers.Authorization).toBe('Bearer ts_live_abc123');
  });

  it('includes the correct User-Agent header', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    await request('https://api.tracestax.com', '/v1/workspace', 'ts_test_key');
    const calledOptions = mockFetch.mock.calls[0][1];
    expect(calledOptions.headers['User-Agent']).toBe('tracestax-cli/0.1.0');
  });

  it('defaults to GET method', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    await request('https://api.tracestax.com', '/v1/workspace', 'ts_test_key');
    const calledOptions = mockFetch.mock.calls[0][1];
    expect(calledOptions.method).toBe('GET');
  });

  it('uses the provided HTTP method', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));
    await request('https://api.tracestax.com', '/v1/alerts/a1/ack', 'ts_test_key', 'POST');
    const calledOptions = mockFetch.mock.calls[0][1];
    expect(calledOptions.method).toBe('POST');
  });

  it('throws on non-2xx HTTP status with status code in message', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));
    await expect(request('https://api.tracestax.com', '/v1/workspace', 'bad_key')).rejects.toThrow(
      'HTTP 401',
    );
  });

  it('throws on 404 with status in message', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(404, 'Not found'));
    await expect(request('https://api.tracestax.com', '/v1/projects/missing', 'ts_test_key')).rejects.toThrow(
      'HTTP 404',
    );
  });

  it('throws when response ok=false with api error message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ ok: false, error: { message: 'Project not found' } }),
    });
    await expect(request('https://api.tracestax.com', '/v1/projects/x', 'ts_test_key')).rejects.toThrow(
      'Project not found',
    );
  });

  it('throws with fallback message when ok=false and no error message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ ok: false }),
    });
    await expect(request('https://api.tracestax.com', '/v1/workspace', 'ts_test_key')).rejects.toThrow(
      'Unknown API error',
    );
  });

  it('truncates long error response bodies to 200 chars', async () => {
    const longBody = 'x'.repeat(500);
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, longBody));
    const err = await request('https://api.tracestax.com', '/v1/workspace', 'ts_test_key').catch((e) => e);
    expect(err.message.length).toBeLessThanOrEqual('HTTP 500: '.length + 200 + 5);
  });
});
