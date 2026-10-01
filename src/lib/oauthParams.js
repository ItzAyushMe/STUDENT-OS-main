// ============================================================
// StudentOS — FIX-AUTH: OAuth redirect parameter parser (pure core)
//
// GoTrue's /authorize called WITHOUT a PKCE code_challenge returns an
// IMPLICIT response: the tokens arrive in the URL FRAGMENT —
//   studentos://auth-callback#access_token=…&refresh_token=…&expires_in=…
// while ?query= responses (e.g. ?code=… or ?error=…) also occur. The old
// parser in auth.js read String(url).split('?')[1] only, so EVERY fragment
// parameter was silently dropped (audit RC2). parseOAuthParams merges both
// into one flat object:
//   - reads the ?query AND the #fragment (fragment wins on duplicate keys —
//     that is where the implicit tokens live)
//   - percent-decodes keys and values ('+' treated as a space)
//   - NEVER throws: null / '' / junk / 'not a url' -> {}
// Zero imports, plain-Node importable (contentLocker/byteContext pattern) so
// scripts/logic-test.mjs proves it deterministically (OA1) without a device.
// The PKCE hardening path (flowType:'pkce' + exchangeCodeForSession) is
// explicitly OUT OF SCOPE for launch per the FIX-AUTH handoff — this parser
// captures `code` too, so that future round needs no parser change.
// ============================================================

/**
 * @param {string} url an OAuth redirect URL (custom scheme or https)
 * @returns {Object} flat string map — {} when there is nothing parseable
 */
export function parseOAuthParams(url) {
  const out = {};
  const s = String(url == null ? '' : url);
  if (!s) return out;
  const addPairs = (segment) => {
    if (!segment) return;
    for (const pair of segment.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const rawK = eq === -1 ? pair : pair.slice(0, eq);
      const rawV = eq === -1 ? '' : pair.slice(eq + 1);
      if (!rawK) continue;
      let k = rawK;
      let v = rawV.replace(/\+/g, ' ');
      try { k = decodeURIComponent(rawK); } catch { /* malformed escape: keep raw */ }
      try { v = decodeURIComponent(v); } catch { /* malformed escape: keep raw */ }
      out[k] = v;
    }
  };
  const hash = s.indexOf('#');
  const base = hash === -1 ? s : s.slice(0, hash);
  const fragment = hash === -1 ? '' : s.slice(hash + 1);
  const q = base.indexOf('?');
  addPairs(q === -1 ? '' : base.slice(q + 1)); // ?query first…
  addPairs(fragment);                          // …then #fragment (wins duplicates)
  return out;
}
