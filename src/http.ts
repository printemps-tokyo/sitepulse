/**
 * One HTTP exchange with a timeout and a bounded retry, shared by the token
 * request and the Search Console calls.
 *
 * The timeout covers the whole exchange, body included, and a failure while
 * reading the body is retried like any other network failure. Server errors
 * (5xx) are retried; everything else is returned to the caller, because the
 * same request would fail the same way.
 */

/** How long one exchange may take, body included. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Extra attempts after a server error (5xx) or a network failure. */
export const RETRIES = 2;

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Exchange {
  status: number;
  ok: boolean;
  text: string;
}

export async function exchange(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch = fetch,
  sleep: Sleep = realSleep,
): Promise<Exchange> {
  for (let attempt = 0; ; attempt++) {
    let result: Exchange;
    try {
      const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      // Read the body inside the try: a connection that drops or times out
      // mid-body is a network failure too.
      result = { status: res.status, ok: res.ok, text: await res.text() };
    } catch (err) {
      if (attempt < RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`request failed: ${(err as Error).message}`);
    }
    if (result.status >= 500 && attempt < RETRIES) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    return result;
  }
}
