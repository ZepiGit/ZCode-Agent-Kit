// Pure, shared quota interpretation. Provider text is untrusted and is never
// copied into user-facing diagnostics. Importable by both CLI and manager.
export function isQuotaSnapshot(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    && body.provider === 'zai' && Array.isArray(body.balances)
    && typeof body.serverTime === 'number' && Number.isFinite(body.serverTime)
    && (body.errors === undefined || (Array.isArray(body.errors) && body.errors.every(e => typeof e === 'string')));
}

export function quotaAuthValid(status, body, diagnostic = diagnoseQuota(status, body)) {
  return status >= 200 && status < 300 && isQuotaSnapshot(body)
    && ['healthy', 'balance', 'balance1113', 'balance3001'].includes(diagnostic.cause);
}

export function diagnoseQuota(status, body) {
  const raw = body?.code ?? body?.error?.code;
  const codes = [Number(raw)];
  // Match the actual billing route's fixed prefixes, not arbitrary numbers
  // in provider prose. Never copy error text into diagnostics or logs.
  for (const error of Array.isArray(body?.errors) ? body.errors : []) {
    const match = typeof error === 'string' && error.match(/^(?:balance|preview):\s*(3012|1113|3001|401|403)(?=\s|$)/);
    if (match) codes.push(Number(match[1]));
  }
  const message = body?.error?.message;
  const match = typeof message === 'string' && message.match(/^\[(3012|1113|3001|401|403)\](?=\s|$)/);
  if (match) codes.push(Number(match[1]));
  const code = codes.find(c => c === 3012) ?? codes.find(c => c === 401 || c === 403) ?? codes.find(c => c === 1113 || c === 3001) ?? Number(raw);
  if (code === 3012) return { code: 5, cause: 'auth3012', detail: 'ZCode auth3012: not logged in. Refresh the Desktop login, then use zcode-kit auth login if still needed; no repeated retries.' };
  if (status === 401 || status === 403 || code === 401 || code === 403) return { code: 5, cause: 'auth', detail: 'ZCode authentication rejected. Check the local key and Desktop login; use zcode-kit doctor --fix for managed config drift.' };
  if (code === 1113 || code === 3001) return { code: 1, cause: `balance${code}`, detail: `ZCode balance${code}: upstream reports insufficient balance/quota. Check your plan/account; restarting the local proxy cannot replenish quota.` };
  // Empty/missing pools are not proof of exhaustion. Only an explicit primary
  // plan status is authoritative; optional quota observability can be partial.
  if (body?.planUsage?.exhausted === true) return { code: 1, cause: 'balance', detail: 'ZCode plan quota is exhausted; check the plan reset time/account balance.' };
  if (status < 200 || status >= 300 || !isQuotaSnapshot(body) || body.error || (Array.isArray(body.errors) && body.errors.length) || (raw !== undefined && code !== 0 && code !== 200)) {
    return { code: 0, cause: 'quota-unavailable', detail: 'ZCode quota information unavailable; continuing with the healthy local proxy. No retry scheduled.' };
  }
  return { code: 0, cause: 'healthy', detail: 'ZCode local proxy ready; quota preflight complete.' };
}
