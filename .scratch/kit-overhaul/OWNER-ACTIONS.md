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

## OA-5 — Confirm GLM account quota availability — unverified, owner action

**Execution-block superseded on 2026-11-10:** the user's explicit fresh-merger instruction authorizes GPT/Grok and says go. OA-5 is now a GLM account-information follow-up only; it does NOT block the authorized GPT/Grok work. This does not restore GLM quota or establish a reset time. Historical no-provider-authorization and prepared/not-dispatched statements below describe the earlier state, not the current routing. This fresh merger used `openai/gpt-6.1-sol-subagent`, with no GLM/Anthropic/Gemini, delegation, additional model request or change to user concurrency. It did not resume/amend/restart the historical stopped workflow. Current merge/gate evidence is in STATE.md and RUNLOG.md.

OA-4 is reserved by the unmerged ticket82 branch for GitHub issue32 live re-observation; this entry does not replace it.

Target: `account:zai-start-plan/GLM-5.3-Flash`, effort `max`. Last known provider result is quota error1005; no reset or restored availability has been confirmed. An automatic continuation reminder is not account-state evidence or permission to buy quota/change provider.

Use the existing signed-in ZCode/provider account interface to inspect the current plan/quota and any stated reset time. If restoration needs a purchase, plan change or reauthentication, that remains the owner's decision. Do not paste credentials, tokens or account-store contents into chat. A non-secret status, reset timestamp and selected provider/model are sufficient for an initial report; a later successful authorized worker must still establish actual execution availability.

No verified safe CLI quota command was found, so none is invented here. The installed UsageStats entitlement method exists, but the known loopback probe requires reading a token and was not executed under B2. Exposed tools and the inspected CLI control interface provided no B2-compatible live quota operation. Evidence: `/home/AgentKit/overhaul-tools/glm-quota-capability-check-20261110.md`.

The signed-in UI path was also checked on2026-11-10: browser-use/control-browser and computer-use skills load, but their required `mcp__node_repl__js` callable is absent from resident tools and both exact/broad deferred discovery. No signed-in account screen was observed, so no quota/reset value can be reported from the UI. This needs a working supported UI bridge or a non-secret owner report, not repeated account/model requests.

Do not automatically resume, amend or restart workflow `dwfrun-658f0456-0734-4f5a-af85-e94e4ee4f5ea`. This owner action supplies quota evidence only, not workflow lifecycle permission or provider-substitution approval. Ticket40's fresh merger handoff is prepared at `/home/AgentKit/overhaul-tools/t40-fresh-merger-ready-20261110.md`; no merger was dispatched.
