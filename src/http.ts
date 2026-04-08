export async function request(endpoint: string, path: string, apiKey: string, method = 'GET'): Promise<any> {
  const url = `${endpoint}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'tracestax-cli/0.1.0',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as { ok: boolean; data?: unknown; error?: { message: string } };
  if (!json.ok) {
    throw new Error(json.error?.message ?? 'Unknown API error');
  }
  return json.data;
}
