# OWNER-ACTIONS — steps only the owner can take

Each item lists exact copy-paste commands and the acceptance criterion it unblocks.

## OA-1 — Live effort probe for ticket 63 (Owner Proxy round 12 Q2)

Run on your own machine with your normal kit install and ZCode login. The key is read into a variable and never printed; the output shows only the HTTP status and the error type, no key, token or account data. Paste the resulting 10-line table into ticket 63's Comments.

Linux/macOS (bash):

```sh
zcode-kit proxy start
KEY="$(zcode-kit models --show-key)"
for model in glm-5.3 glm-5.3-flash; do
  for effort in low medium high xhigh max; do
    body=$(printf '{"model":"%s","max_tokens":64,"output_config":{"effort":"%s"},"messages":[{"role":"user","content":"Reply with ok"}]}' "$model" "$effort")
    out=$(curl -s -o /tmp/zk-probe.json -w '%{http_code}' -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' -d "$body" http://127.0.0.1:8457/v1/messages)
    err=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync("/tmp/zk-probe.json","utf8"));console.log(j.error?.type??"-")}catch{console.log("unparsed")}')
    echo "$model $effort HTTP $out error=$err"
  done
done
unset KEY; rm -f /tmp/zk-probe.json
```

Windows (PowerShell 7):

```powershell
zcode-kit proxy start
$key = zcode-kit models --show-key
foreach ($model in 'glm-5.3','glm-5.3-flash') { foreach ($effort in 'low','medium','high','xhigh','max') {
  $body = @{ model=$model; max_tokens=64; output_config=@{ effort=$effort }; messages=@(@{ role='user'; content='Reply with ok' }) } | ConvertTo-Json -Depth 5
  try { $r = Invoke-WebRequest -Uri http://127.0.0.1:8457/v1/messages -Method Post -Body $body -ContentType 'application/json' -Headers @{ 'x-api-key'=$key; 'anthropic-version'='2023-06-01' } -SkipHttpErrorCheck
        $type = try { ($r.Content | ConvertFrom-Json).error.type } catch { 'unparsed' }
        "$model $effort HTTP $($r.StatusCode) error=$(if ($type) { $type } else { '-' })" } catch { "$model $effort failed: $($_.Exception.GetType().Name)" } } }
Remove-Variable key
```

Port: replace 8457 if your `proxy/config.yaml` sets another. Unblocks: ticket 63 (re-triage).

## OA-2 — Ctrl-C at a setup question in plain mode on a Windows console (ticket 42)

In Windows PowerShell 5.1 and in PowerShell 7, in both conhost and Windows Terminal, on a machine where the kit is installed:

```powershell
$env:NO_COLOR = '1'
zcode-kit setup --reask
# at the first question press Ctrl-C
echo "exit=$LASTEXITCODE"
Remove-Item Env:NO_COLOR
```

Expected: setup stops at once with exit 130 and no traceback, no escape sequences are printed, and a second `zcode-kit setup --reask` asks the same question again (nothing was stored). Unblocks: ticket 42's plain-mode Ctrl-C criterion (no automated proof on a real console).

## OA-3 — Ctrl-C, Ctrl-Break and console close during `proxy start` on a real Windows console (ticket 17, A2) — unverified, owner action

Run in Windows PowerShell 5.1 and in PowerShell 7, in both conhost and Windows Terminal, on a machine where the kit is installed. Each step interrupts a start while it holds the start lock. The proxy then comes up on its own, because it is detached.

```powershell
zcode-kit proxy stop
# 1. Ctrl-C: press Ctrl-C as soon as "starting zcode-proxy ..." appears
zcode-kit proxy start
zcode-kit proxy logs 30 | Select-String 'start lock released on signal|lock takeover'
zcode-kit proxy start      # adopts the proxy the interrupted start left
zcode-kit proxy stop       # expected: stopped (pid N)
# 2. Ctrl-Break: the same, pressing Ctrl-Break instead of Ctrl-C
zcode-kit proxy start
zcode-kit proxy logs 30 | Select-String 'start lock released on signal|lock takeover'
zcode-kit proxy start; zcode-kit proxy stop
# 3. Console close: run `zcode-kit proxy start` in a new console window and close
#    that window while "starting zcode-proxy ..." is shown; then, in this window:
zcode-kit proxy logs 30 | Select-String 'start lock released on signal|lock takeover'
zcode-kit proxy start; zcode-kit proxy stop
```

Expected, for each of the three:
- the log shows `INFO manager start lock released on signal signal=SIGINT` (`SIGBREAK` for Ctrl-Break, `SIGHUP` for console close);
- the next `proxy start` prints no `WARN manager lock takeover` line, exits 0 and starts no second proxy (Task Manager shows one `bun.exe … serve`);
- `proxy stop` prints `stopped (pid N)` and leaves no `bun.exe … serve` running.

Unblocks: ticket 17's criterion "A2 (real PowerShell/conhost Ctrl-C) listed as an owner action, marked unverified". The seam tests deliver these events through Node's own signal listeners (`process.emit`), not through a real console.

## OA-4 — GitHub issue 32 live re-observation on the owner's machine (ticket 82) — unverified, owner action

The incident (HTTP 405 + business code 3012 on POST /v1/chat/completions, repeated guest-script TypeErrors, code-0 claim preview with no data, kit v0.2.42) is NOT resolved by ticket 82: no reproducer exists and the three earlier investigation reports disagree on the cause. This owner-only run collects the client-visible evidence the new build produces. It is read-only: one "Reply with ok" request, no credential printing, no challenge/tooling changes.

On a machine with your normal kit install and ZCode login, after a build containing ticket 82:

```sh
zcode-kit proxy start
KEY="$(zcode-kit models --show-key)"
curl -s -o /tmp/zk-i32.json -w 'HTTP %{http_code}\n' -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d '{"model":"glm-5.3-flash","max_tokens":16,"messages":[{"role":"user","content":"Reply with ok"}]}' \
  http://127.0.0.1:8457/v1/messages
node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/zk-i32.json","utf8"));console.log(JSON.stringify(j.error??{ok:true,stop:j.stop_reason}),null,1)'
zcode-kit proxy stop
rm -f /tmp/zk-i32.json; unset KEY
```

Expected interpretation:
- success → inference works on this machine; the incident was environment- or version-specific (state which kit version the reporter ran vs yours);
- `{"type":"…","message":"[3012] upstream authorization rejected"}` → the gateway is genuinely rejecting authorization for this account/window; the classification is preserved and the cause is upstream of the kit;
- a 503 `captcha_solver_failed` body containing `(last local mint failure: …)` → the local solver refused degraded results; the provenance line is the diagnostic to attach to the issue;
- a code-0 preview with no data now surfaces `preview: provider_unknown` in `zcode-kit quota` errors — that is the fail-closed record, not a silent empty success.

Paste the (redacted) output into ticket 82's Comments and only then decide whether GitHub #32 can move. Unblocks: ticket 82's criterion "Do not close GitHub #32 … record the limitation and an exact owner-only verification procedure".
