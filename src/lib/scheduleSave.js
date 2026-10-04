// Pure helpers for atomic schedule save — FIX-GEN-ATOMIC
// No react-native, no supabase, no db — fully unit-testable

export function chunkRows(rows, size = 500) {
  if (!Array.isArray(rows)) return [];
  const s = Math.max(1, Number(size) || 500);
  const out = [];
  for (let i = 0; i < rows.length; i += s) {
    out.push(rows.slice(i, i + s));
  }
  return out;
}

export function isRunStale(currentRun, myRun) {
  return currentRun !== myRun;
}

// Worker-pool save: runs insertFn(chunk) with concurrency, reports progress
// insertFn: async (chunk, index) => void
// onProgress: (completed, total) => void
// shouldAbort: () => boolean — if true, stops early
// Returns { savedCount, totalRows, failedIndexes }
export async function saveWithWorkers(chunks, insertFn, onProgress, concurrency = 2, shouldAbort = () => false) {
  const total = chunks.length;
  let completed = 0;
  let savedCount = 0;
  const failedIndexes = [];
  let nextIdx = 0;

  const worker = async () => {
    while (true) {
      if (shouldAbort()) break;
      const cur = nextIdx++;
      if (cur >= total) break;
      const chunk = chunks[cur];
      try {
        await insertFn(chunk, cur);
        savedCount += chunk.length;
      } catch (e) {
        // retry once
        try {
          await insertFn(chunk, cur);
          savedCount += chunk.length;
        } catch (e2) {
          failedIndexes.push(cur);
        }
      }
      completed += 1;
      if (typeof onProgress === 'function') {
        try { onProgress(completed, total); } catch {}
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return { savedCount, totalRows: chunks.reduce((a, c) => a + c.length, 0), failedIndexes, completed };
}
