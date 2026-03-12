import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { mockCreate, MockAPIError } = vi.hoisted(() => {
  const mockCreate = vi.fn();

  class MockAPIError extends Error {
    status: number;

    constructor(status: number, message = 'API error') {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }

  return { mockCreate, MockAPIError };
});

vi.mock('openai', () => {
  class OpenAI {
    static APIError = MockAPIError;

    chat = {
      completions: {
        create: mockCreate,
      },
    };

    constructor(_config: unknown) {}
  }

  return { default: OpenAI };
});

import { GET, POST } from './route';

let ipCounter = 0;

function makeRequest(
  body: unknown,
  options?: {
    contentType?: string;
    ip?: string;
    rawBody?: boolean;
  },
): NextRequest {
  const headers = new Headers();
  if (options?.contentType !== undefined) {
    headers.set('content-type', options.contentType);
  } else {
    headers.set('content-type', 'application/json');
  }

  headers.set('x-forwarded-for', options?.ip || `test-ip-${++ipCounter}`);

  const payload = options?.rawBody ? String(body) : JSON.stringify(body);

  return new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers,
    body: payload,
  }) as unknown as NextRequest;
}

const validModelResponse = {
  overall_score: 85,
  architecture_score: 80,
  readability_score: 88,
  performance_score: 82,
  summary: 'Good code quality overall.',
  patterns_detected: ['Factory'],
  performance_concerns: ['None'],
  refactoring_suggestions: [
    { severity: 'low' as const, suggestion: 'Extract helper function' },
  ],
};

describe('POST /api/analyze', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.ADMIN_DEBUG_TOKEN = 'debug-secret';
    mockCreate.mockReset();
  });

  it('returns 404 for debug endpoint without admin token', async () => {
    const response = await GET(makeRequest({}));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Not found',
    });
  });

  it('returns masked env status for debug endpoint with valid token', async () => {
    const req = makeRequest({}, { ip: '203.0.113.9' });
    req.headers.set('x-admin-debug-token', 'debug-secret');

    const response = await GET(req);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: true,
        provider: 'openai',
        routeVersion: '2026-03-11-v2',
        hasOpenAIKey: true,
        hasAnthropicKey: false,
      }),
    );
    expect(typeof payload.timestamp).toBe('string');
  });

  it('returns 415 for non-json content type', async () => {
    const response = await POST(
      makeRequest({ code: 'const a = 1;' }, { contentType: 'text/plain' }),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: 'Content-Type must be application/json.',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed json payload', async () => {
    const response = await POST(makeRequest('{bad json', { rawBody: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON payload.',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when code is missing or not a string', async () => {
    const response = await POST(makeRequest({ code: 123 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '"code" must be a string.',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when code exceeds max byte size', async () => {
    const oversized = 'a'.repeat(50_001);
    const response = await POST(makeRequest({ code: oversized }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Code too large (max 50KB).',
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 429 on rate limit exceed for same client key', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validModelResponse) } }],
    });

    const ip = '198.51.100.10';

    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest({ code: 'const x = 1;' }, { ip }));
      expect(res.status).toBe(200);
    }

    const blocked = await POST(makeRequest({ code: 'const x = 1;' }, { ip }));

    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Max 10 requests per minute.',
    });
  });

  it('returns 502 when model response is invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not-json' } }],
    });

    const response = await POST(makeRequest({ code: 'const x = 1;' }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Analysis service returned an invalid format.',
    });
  });

  it('returns 503 when upstream service is rate limited', async () => {
    mockCreate.mockRejectedValue(new MockAPIError(429, 'Too Many Requests'));

    const response = await POST(makeRequest({ code: 'const x = 1;' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Analysis service is busy. Try again shortly.',
    });
  });

  it('returns 200 with no-cache headers for valid analysis', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validModelResponse) } }],
    });

    const response = await POST(makeRequest({ code: 'const x = 1;' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(validModelResponse);
    expect(response.headers.get('Cache-Control')).toBe(
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
