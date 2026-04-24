// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import type { Request, Response } from 'express';
import { proxyHandler } from '@/server';

vi.mock('axios');

function createMockResponse() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let body = '';
  let ended = false;

  const response = {
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return response;
    }),
    send: vi.fn((value: string) => {
      body = value;
      ended = true;
      return response;
    }),
    write: vi.fn((chunk: Buffer | string) => {
      body += chunk.toString();
      return true;
    }),
    end: vi.fn((chunk?: Buffer | string) => {
      if (chunk) body += chunk.toString();
      ended = true;
      return response;
    }),
  } as unknown as Response;

  return {
    response,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get ended() {
      return ended;
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
}

describe('server proxy route', () => {
  it('returns 400 when url is missing', async () => {
    const res = createMockResponse();

    await proxyHandler({ query: {} } as Request, res.response);

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('URL is required');
  });

  it('forwards successful upstream responses', async () => {
    const stream = {
      pipe: vi.fn((destination: Response) => {
        destination.write('video-bytes');
        destination.end();
      }),
      on: vi.fn(),
    };
    vi.mocked(axios).mockResolvedValueOnce({
      data: stream,
      headers: { 'content-type': 'video/mp4' },
    } as never);

    const res = createMockResponse();
    const responsePromise = proxyHandler(
      { query: { url: 'https://example.com/video.mp4' } } as unknown as Request,
      res.response,
    );
    await responsePromise;

    expect(res.statusCode).toBe(200);
    expect(res.getHeader('content-type')).toContain('video/mp4');
    expect(res.getHeader('cache-control')).toBe('public, max-age=3600');
    expect(res.body).toBe('video-bytes');
  });

  it('returns 500 when the upstream request fails', async () => {
    vi.mocked(axios).mockRejectedValueOnce(new Error('boom'));
    const res = createMockResponse();

    await proxyHandler(
      { query: { url: 'https://example.com/video.mp4' } } as unknown as Request,
      res.response,
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('Failed to fetch resource');
  });

  it('ends the response when the upstream stream errors', async () => {
    let onError: ((error: Error) => void) | undefined;
    const stream = {
      pipe: vi.fn((destination: Response) => {
        destination.write('partial');
      }),
      on: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === 'error') onError = handler;
      }),
    };
    vi.mocked(axios).mockResolvedValueOnce({
      data: stream,
      headers: { 'content-type': 'video/mp4' },
    } as never);

    const res = createMockResponse();
    const responsePromise = proxyHandler(
      { query: { url: 'https://example.com/video.mp4' } } as unknown as Request,
      res.response,
    );
    await responsePromise;
    onError?.(new Error('stream exploded'));

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('partial');
    expect(res.ended).toBe(true);
  });
});
