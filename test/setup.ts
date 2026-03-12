import { fetch, Headers, Request, Response } from 'undici';

if (!globalThis.fetch) {
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
}

if (!globalThis.Headers) {
  globalThis.Headers = Headers as unknown as typeof globalThis.Headers;
}

if (!globalThis.Request) {
  globalThis.Request = Request as unknown as typeof globalThis.Request;
}

if (!globalThis.Response) {
  globalThis.Response = Response as unknown as typeof globalThis.Response;
}
