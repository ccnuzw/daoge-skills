export const ASSET_IMPORT_CONCURRENCY = 4;

export async function mapWithConcurrency(items, worker, limit = ASSET_IMPORT_CONCURRENCY) {
  const values = Array.from(items || []);
  const concurrency = Math.max(1, Math.min(values.length || 1, Math.floor(Number(limit) || ASSET_IMPORT_CONCURRENCY)));
  const results = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}
