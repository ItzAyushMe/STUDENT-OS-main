// NEW X R4: pure model guard — no react-native deps, testable in node
export function looksLikeMissingModel(errMsg) {
  return /404|not found|NOT_FOUND|does not exist|decommissioned|unsupported model|model_not_found|no longer available|not available to new users|shut down/i.test(String(errMsg));
}

export function isRetryable(errMsg) {
  return /429|502|503|504|overload|high demand|rate.?limit|too many requests|service unavailable|temporarily/i.test(String(errMsg));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callProvider(models, requester, args) {
  let lastErr;
  const start = Date.now();
  const MAX_TOTAL_MS = 90000;
  for (let mi = 0; mi < models.length; mi++) {
    const attempts = mi === 0 ? 3 : 1;
    const waits = [0, 2000, 4000];
    for (let a = 0; a < attempts; a++) {
      if (Date.now() - start > MAX_TOTAL_MS) {
        throw new Error(`AI timeout — total time ${MAX_TOTAL_MS / 1000}s exceeded, dobara try karo`);
      }
      if (waits[a]) await sleep(waits[a]);
      try {
        return await requester(models[mi], args);
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || '');
        const timeoutLike = /timeout/i.test(msg);
        if ((isRetryable(msg) || timeoutLike) && a < attempts - 1) continue;
        if (isRetryable(msg) || looksLikeMissingModel(msg) || timeoutLike) break;
        throw e;
      }
    }
  }
  throw lastErr;
}
