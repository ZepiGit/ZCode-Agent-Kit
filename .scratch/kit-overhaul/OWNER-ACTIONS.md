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
