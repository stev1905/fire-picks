// Small fetch helpers shared by the ESPN-backed NBA builders.

export async function getJson<T = unknown>(url: string, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404) return null;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
