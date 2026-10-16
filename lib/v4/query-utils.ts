/**
 * Keep D1 `IN (...)` statements below the platform binding limit. The
 * default leaves room for owner/profile/status parameters used by callers.
 */
export const DEFAULT_D1_ID_BATCH_SIZE = 90;

export function chunkIds(ids: readonly string[], maxBindings = DEFAULT_D1_ID_BATCH_SIZE): string[][] {
  if (!Number.isInteger(maxBindings) || maxBindings <= 0) throw new Error("maxBindings must be a positive integer.");
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += maxBindings) chunks.push(unique.slice(index, index + maxBindings));
  return chunks;
}

export async function selectInChunks<T>(
  ids: readonly string[],
  select: (ids: string[]) => Promise<T[]>,
  maxBindings = DEFAULT_D1_ID_BATCH_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (const chunk of chunkIds(ids, maxBindings)) rows.push(...await select(chunk));
  return rows;
}
