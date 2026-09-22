# SECURITY.md

## Vertrauensgrenzen und Durchsetzung

1. **Workspace-Allowlist (technisch durchgesetzt).** Jede Task-Start-, Workspace- und
   Artefakt-Operation prüft den Eingabepfad gegen die Allowlist (`--allow-workspace`, Env,
   Bridge-Workspace-Dir). Pfade werden per `realpath` aufgelöst (Symlinks/Junctions), drive-letter-
   und slash-normalisiert und segmentweise abgeglichen (`C:\work` matched nicht `C:\workshop`).
   Artefakt-Lesezugriffe: `resolveInsideWorkspace` verweigert `..`-Escapes **und** Symlink-Sprünge.
2. **Read-only-Modus (technisch durchgesetzt, nicht nur annotiert).** `--read-only` lässt mutierende
   Tools (`session_create/resume/fork/close/compact/goal`, `model_set`, `settings_update/reset`,
   `task_start/input/cancel`, `interaction_respond`) mit `READ_ONLY_MODE`-Fehler scheitern — geprüft
   im Handler, nicht über Tool-Annotationen. Zusätzlich: Task-`readOnly:true` setzt im **Harness**
   den Plan-Modus (`session/setMode plan`) und eine `toolDenylist` (Write/Edit/MultiEdit/NotebookEdit/
   Bash/PowerShell/…) bei `session/send` — Enforcement liegt teils in der Runtime selbst.
   Grenze (ehrlich): Shell/Interpreter-Escape über *erlaubte* Tools oder Subagents kann allein durch
   Werkzeug-Denylists nicht garantiert werden; für starke Garantien isolierte Workspaces verwenden.
3. **Prozessstart.** Ein einziger Launch-Punkt (`src/runtime/spawn.ts`): Programm ist das feste
   Literal `node` (vom OS aus PATH; Discovery verifiziert vorher), Argumente als Array, `shell:false`,
   `windowsHide`. Kein Kommandozeilen-String wird je aus Eingaben verkettet. Kein Model-/Tool-Output
   fließt in Programm- oder Argumentpfade des Launches.
4. **Secrets.** Alle strukturierten Ausgaben (Tool-Results, Events, Logs, Fehler) laufen durch
   `redactDeep`: Schlüssel wie `apiKey/authToken/authorization/password/secret/credential/cookie/
   x-aliyun-captcha-verify-param` werden maskiert, bekannte Token-Formen (`sk-…`, `Bearer …`,
   sehr lange opake Strings) redigiert. Die Bridge verwaltet **keine** Credentials: Der Harness nutzt
   die lokale Z.AI-OAuth-Anmeldung; Provider-Header und Captcha-Tokens werden nie gefälscht, nie
   gespeichert, nie durchgereicht. MCP-Responses enthalten keine Secrets.
5. **Rückfragen/Autorität.** Ein aufrufender Agent kann seine Berechtigung nicht erweitern:
   `zcode_interaction_respond` akzeptiert ausschließlich Optionen, die der Harness angeboten hat;
   Antworten werden per Feld-Whitelist (`sanitizeInteractionReply`) in sichere Formen `{decision,
   reason}` / `{answers, cancelled}` umgebaut. Ablauf: Timeout → deny. Doppel-/Spätantworten werden
   atomar abgelehnt. Policy-Stufen: `deny` (Default), `allowlist` (Nur-Tool-Präfixe), `ask`.
6. **Keine rekursive Selbstdelegation.** Die Bridge registriert sich nicht selbst in der ZCode-
   Runtime/Konfiguration und schreibt keine ZCode-Dateien (`~/.zcode/cli/config.json`,
   `~/.zcode/v2/setting.json` sind nur lesend inventarisiert). Tiefe/Ketten von Delegationen sind
   durch die Interaktions-Policy gedämpft: Jede Permission muss durch eine Bridge-Policy oder eine
   explizite Agent-Antwort laufen.
7. **Netzwerk.** HTTP-Modus bindet standardmäßig `127.0.0.1`; Origin-Prüfung; keine öffentliche
   Freigabe, kein Auto-TLS-Endpunkt. Remote-Zugriff nur über dokumentierten TLS-Proxy + eigene
   Autorisierungsschicht. Eine Task-/Session-ID ist keine Zugriffsberechtigung.
8. **Persistenz.** `dataDir` mit relativen Pfad-Checks (Escape-Verweigerung), atomare Writes
   (temp+rename, `randomUUID`-Suffixed Tempfiles). Interactions/Tasks/Results landen im Bridge-
   eigenen Datenverzeichnis, nie in ZCode-Datenbanken; SQLite/DBs von ZCode werden nicht geschrieben.
9. **Robustheit.** Request-Timeouts (Default 60s), max. 2 parallele Tasks (konfigurierbar), Queue-
   Limit 50, begrenzte Frame-Puffer (32 MB), kein automatischer Retry außer einem transparenten
   Restart nach Harness-Exit für den nächsten Aufruf; Abbruch wird verifiziert statt behauptet;
   Graceful Shutdown markiert offene Tasks ehrlich als `interrupted`.

## Bekannte Restrisiken (mit Gegenmaßnahmen-Status)

| Risiko | Status |
| --- | --- |
| Model-Turns könnten trotzdem Dateien ändern, wenn Plan-Modus+Denylist im Harness umgangen werden | Teil-Enforcement; für harte Garantien `--read-only` **und** isolierte Workspace-Copies nutzen |
| Workspace-Hooks (Plugins) können Code ausführen, sobald ein Task in einem Workspace läuft | `workspace/hooks/trustGrant` wird von der Bridge nie erteilt; Hook-Trust bleibt Desktop/Operator vorbehalten |
| YAML/JSON-Injection über Task-Prompts | Prompts sind Modell-Kontext, keine Befehle; Interaktionen erweitern keine Rechte |
