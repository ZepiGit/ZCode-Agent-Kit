# Glossar
[English (original)](GLOSSARY.md) · **Deutsch** · [Español](GLOSSARY.es.md) · [日本語](GLOSSARY.ja.md) · [简体中文](GLOSSARY.zh-CN.md)

Das Kit betreibt einen lokalen ZCode-Proxy und verbindet deine eigenen Agent-Harnesses mit ihm. Dieses Glossar erklärt die Begriffe, die in der Ausgabe von `zcode-kit` und in den Dokumenten des Kits vorkommen. Wo der deutsche Begriff vom englischen abweicht, steht der englische in Klammern.

## Installation und Prozesse

**Installation**:
Eine Kopie des Kits (Release-Installation, npm-Installation oder Quellcode-Checkout) mit eigener Konfiguration, eigenem Proxy-Schlüssel und eigenem Zustand. Alles Weitere in diesem Glossar gibt es je Installation.

**Upstream**:
Der ZCode-Dienst des Anbieters, an den der Proxy Modellanfragen weiterleitet.

**Proxy**:
Der lokale HTTP-Dienst der Installation auf Loopback. Er spricht mit den Harnesses im Anthropic- und im OpenAI-Format und leitet an den Upstream weiter. Jede Installation hat genau einen.

**Proxy-Schlüssel (proxy key)**:
Das lokale Geheimnis, das ein Client an den Proxy senden muss. Das Setup erzeugt ihn und legt ihn in `.proxykey` ab.

**Manager**:
Die Komponente des Kits, die den Proxy startet, stoppt und neu startet. `zcode-kit proxy start`, `stop` und `restart` verwenden sie.

**Identitätsnachweis (identity proof)**:
Eine authentifizierte Health-Antwort, die zeigt, dass der Prozess auf dem konfigurierten Port der eigene Proxy dieser Installation ist. Mögliche Ergebnisse sind *ours* (eigener Proxy), *foreign* (auf dem Port antwortet etwas anderes), *down* (nichts antwortet) und *no key* (der Proxy-Schlüssel fehlt, daher lässt sich nichts nachweisen). `zcode-kit proxy status --json` meldet sie im Feld `health` als `ours`, `foreign`, `down` und `nokey`.

**PID-Eintrag (pid record)**:
Die Datei `logs/proxy.pid`, in der der Manager die PID und die Startzeit des Proxys festhält. Der Manager stoppt einen Prozess nur, wenn er zu diesem Eintrag passt. Meldungen nennen sie auch PID-Datei (pid file).

**Harness**:
Eine Agent-CLI oder Editor-Erweiterung, die den Proxy als Modellanbieter nutzt, etwa Claude Code, Codex, OMP oder OpenCode. Andere Dokumente nennen sie auch Assistent.

**Integration**:
Die Konfiguration, die das Kit mit deiner Zustimmung für eine Harness schreibt, damit sie den Proxy nutzt.

**Launcher**:
Der Prozess `zcode-kit run <harness>`. Er führt den Preflight aus und startet die Harness. Wo eine Übergabe möglich ist, ersetzt er sich danach durch die Harness; sonst bleibt er bis zu ihrem Ende bestehen und gibt ihren Exit-Code zurück.

**Preflight**:
Eine kurze Prüfung, bevor eine Harness den Proxy nutzt. Sie stellt sicher, dass der Proxy läuft und zu dieser Installation gehört, startet ihn bei Bedarf und prüft das Kontingent.

**MCP-Bridge (MCP bridge)**:
Der MCP-Server, der einer Harness Tools aus der installierten ZCode-Desktop-Runtime bereitstellt. Ihn zu registrieren ist nicht dasselbe, wie ein Modell anzubinden.

**Transaktion (transaction)**:
Die Aufzeichnung der Dateiänderungen, die ein einzelner Lauf eines Befehls wie `setup`, `integrate`, `update` oder `accounts enable` vorgenommen hat, samt Backups. `zcode-kit rollback [tx-id]` macht die neueste oder die angegebene rückgängig.

**Speicherbedarf (memory footprint)**:
Der Speicher, den das Betriebssystem dem Proxy-Prozess zurechnet. Die Speichergrenzen des Proxys werden daran gemessen. Wo die Runtime ihn nicht melden kann, wird stattdessen die Resident Set Size (RSS) verwendet.

**Übergabe (handover)**:
Der Launcher ersetzt sich durch den Assistenten. Der Assistent behält so die Prozess-ID des Launchers, und neben ihm bleibt kein Kit-Prozess bestehen. Gilt unter Linux und macOS mit Node.js 26.1 oder neuer; `ZCODE_KIT_RESIDENT_LAUNCHER=1` schaltet sie ab.

**Gemeinsamer Preflight (shared preflight)**:
Ein einziger Preflight für mehrere OMP-Fenster einer Installation, die gleichzeitig starten. Das Fenster, das `logs/omp-autostart.token` anlegt, führt ihn aus; die anderen warten auf sein Ergebnis.

## Lebenszyklus des Proxys und die Startsperre

**Startsperre (start lock)**:
Die Datei `logs/manager.lock`. Sie hält fest, dass für diese Installation gerade ein Start des Proxys läuft. Es gibt höchstens einen Inhaber zur gleichen Zeit.

**Inhaber (holder)**:
Der Prozess, der in der Startsperre als derjenige eingetragen ist, der den Start durchführt.

**Zurückgebliebene Sperre (stale lock)**:
Eine Startsperre, deren Inhaber nachweislich nicht mehr existiert: Sein Prozess ist beendet, oder seine PID gehört inzwischen zu einem später gestarteten Prozess. Eine Sperre, die nur alt ist oder deren Inhaber sich nicht prüfen lässt, gilt nicht als zurückgeblieben.

**Übernahme (takeover)**:
Eine zurückgebliebene Sperre wird durch die eigene ersetzt, damit ein Start weiterlaufen kann. Die Sperre eines lebenden Inhabers wird nie übernommen.

**Startfrist (startup grace)**:
Die ersten 60 Sekunden nach dem Start eines Proxys. Ein Proxy, der noch nicht antwortet, wird in dieser Zeit nie beendet.

**Verwaister Proxy (orphaned proxy)**:
Ein funktionierender Proxy, der weiterläuft, nachdem der Start, der ihn erzeugt hat, unterbrochen wurde. Der nächste Start übernimmt ihn über den Identitätsnachweis, statt einen weiteren zu starten.

**Hängender Proxy (hung proxy)**:
Der eigene Proxy der Installation, der läuft, aber nicht auf Gesundheitsprüfungen antwortet. Das Kit beendet ihn nur, wenn nachgewiesen ist, dass er sowohl der eigene ist als auch hängt.

**Health-Supervisor (health supervisor)**:
Der Teil des Proxys, der den eigenen Haupt-Thread und den Speicherbedarf beobachtet. Er entscheidet, ob der Proxy warnt, einen Neustart anfordert oder weiterarbeitet.

**Automatischer Neustart (automatic restart)**:
Die Anforderung des Proxys an den Manager, ihn frisch zu starten, nachdem sein Haupt-Thread nicht mehr reagiert hat oder sein Speicher über der harten Grenze geblieben ist. Logzeilen nennen das Respawn. Das Neustart-Budget begrenzt diese Neustarts.

**Neustart-Budget (restart budget)**:
Die Zahl automatischer Neustarts, die der Manager in einem gleitenden Zeitfenster annimmt: 3 innerhalb von 15 Minuten.

**Respawn-Bestätigung (respawn acknowledgement)**:
Die vom Manager festgehaltene Bestätigung, dass er die Anforderung eines Proxys für einen automatischen Neustart angenommen hat. Ein Proxy, der wegen des Speichers angefragt hat, läuft erst danach aus; ohne Bestätigung arbeitet er weiter.

**Auslaufen (drain)**:
Die Phase eines geordneten Stopps, in der der Proxy seinen Listener offen hält, neue Anfragen abweist und bereits laufende Anfragen bis zu seiner Frist abschließen lässt.

**Stopp-Anfrage (stop request)**:
Die authentifizierte Loopback-Anfrage (`POST /__kit/stop`), mit der der Manager den eigenen Proxy auffordert, sich geordnet zu beenden. Sie braucht den Proxy-Schlüssel und das Stopp-Token.

**Stopp-Token (stop token)**:
Das Geheimnis, das bei jedem Start neu erzeugt wird und zusammen mit dem Proxy-Schlüssel eine Stopp-Anfrage autorisiert. Es liegt im PID-Eintrag und gehört zu keiner Harness-Konfiguration.

**Neustart (restart)**:
Ein Stopp mit anschließendem Start des Proxys, angefordert mit `zcode-kit proxy restart`.

## CAPTCHA-Solver

**Lösung (solve)**:
Ein Durchlauf der CAPTCHA-Aufgabe des Anbieters in einer Headless-Seite. Ergebnis ist ein Token oder ein Fehlschlag.

**Solver**:
Der Teil des Proxys, der Lösungen durchführt, eine nach der anderen in der Reihenfolge ihres Eintreffens.

**Solver-Prozess (solver process)**:
Der Prozess, den der Proxy für den Solver startet. Je Proxy gibt es höchstens einen. Er hat eine Speichergrenze (`solver.memoryCapMB`, standardmäßig 300 MB), die das Betriebssystem durchsetzt, wo es das kann.

**Austausch (recycle)**:
Der Solver-Prozess wird vor der nächsten Lösung durch einen frischen ersetzt: bei 80 % der Speichergrenze oder nach 100 Lösungen.

**Sofortabbruch (fail-fast)**:
Die Zeit, in der der Proxy keinen Solver-Prozess startet, weil innerhalb von 10 Minuten mehr als 5 davon abnormal beendet wurden. Anfragen, die eine Lösung brauchen, erhalten HTTP 503 mit `Retry-After`.

## Zulassung

**Zulassung (admission)**:
Die Entscheidung des Proxys für jede einzelne Anfrage, den Anfragekörper jetzt zu verarbeiten, ihn warten zu lassen oder ihn abzuweisen.

**Belegte Bytes (in-flight bytes)**:
Die Gesamtgröße der Anfragekörper, die der Proxy gerade hält, vom Einlesen eines Körpers bis zur Antwort des Upstreams.

**Byte-Grenze (byte cap)**:
Die Grenze für belegte Bytes, standardmäßig 64 MiB (`server.admission.maxInFlightMB`). Sie ist die einzige Zulassungsgrenze; offene Antwort-Streams sind nicht begrenzt.

**Zulassungswarteschlange (admission queue)**:
Die begrenzte Warteschlange von Anfragen, die nach dem Prinzip „first in, first out“ auf ihre Zulassung warten und deren Körper noch nicht gelesen wurden. Höchstens 64 Anfragen warten, jede höchstens 15 Sekunden.

**Abweisen (shed)**:
Eine Anfrage, die nicht zugelassen werden konnte oder während des Auslaufens eintraf, mit HTTP 503 und `Retry-After` im Fehlerformat des aufgerufenen Endpunkts ablehnen. Eine Abweisung ist nie ein Kontingentfehler.

## Konten

**Account Rotator**:
Die optionale Funktion, die mehrere autorisierte Logins als getrennte Konten verwaltet. Siehe [ACCOUNT_ROTATOR.de.md](ACCOUNT_ROTATOR.de.md).

**Aktives Konto (active account)**:
Das Konto, das der Proxy gerade nutzt. In den Kontotabellen ist es mit `*` markiert.

**Urteil (verdict)**:
Der Zustand, den `zcode-kit accounts health` jedem Konto zuweist, etwa `ok`, `low` oder `exhausted`.

**Kontingentpaket (quota package)**:
Ein Guthaben, das der Anbieter für ein Konto meldet, mit verbleibenden und gesamten Einheiten und einer Reset-Zeit.

**Cooldown**:
Die Zeit, in der ein Konto nach einem Kontingentfehler nicht verwendet wird.

## MCP-Tasks

**Task-Aufbewahrung (task retention)**:
Wie lange beendete MCP-Tasks und ihre Ergebnisse aufbewahrt werden, bevor sie entfernt werden: höchstens 500 beendete Tasks und höchstens 7 Tage. Der Idempotenzschlüssel eines Tasks bleibt genau so lange bekannt, wie der Task aufbewahrt wird.

**Neustart-Budget (restart budget)**:
Wie oft die MCP-Bridge ihre ZCode-Runtime neu startet, nachdem diese beendet wurde: höchstens 3-mal in 15 Minuten. Ist das Budget verbraucht, schlagen Tools, die die Runtime brauchen, mit `HARNESS_RESTART_BUDGET_EXHAUSTED` fehl, bis wieder ein Platz frei ist.

## Logs

**Proxy-Log (proxy log)**:
`logs/proxy.log`, geschrieben vom Proxy und vom Manager. Bei 5 MB wird es rotiert, mit einer älteren Datei, `proxy.log.1`. `zcode-kit proxy logs` liest es.

**Heal-Log (heal log)**:
`logs/heal.log`, ein kurzes Protokoll dessen, was der Preflight und der Manager vorgefunden und getan haben. Es verwendet ein festes Vokabular und enthält keine Texte des Anbieters, keine Pfade und keine Zugangsdaten.

## Terminalausgabe

**Bericht (report)**:
Die Antwort eines Befehls: Prüfzeilen und Ergebniszeile, Statustext, die Setup-Zusammenfassung, die Verbindungsdaten. Berichte und Daten gehen an stdout.

**Diagnose (diagnostic)**:
Alles rund um die Antwort eines Befehls: Fortschritt, Warnungen, Fehlerblöcke, Rückfragen und Bedienfehler. Diagnosen gehen an stderr.

**Prüfung (check)**:
Ein benannter Test in `zcode-kit doctor`, einschließlich des Upstream-Vergleichs von `doctor --upstream`.

**Prüfergebnis (check verdict)**:
Das Ergebniswort einer Prüfung: *PASS*, *FAIL*, *WARN* oder *SKIP*. Nur *FAIL* lässt den Befehl fehlschlagen. *WARN* heißt, dass es funktioniert, aber Aufmerksamkeit braucht; *SKIP* heißt, dass die Prüfung nicht zutrifft oder nichts erkannt wurde. `zcode-kit accounts doctor` gibt stattdessen eigene Wörter aus: *OK*, *WARNING* und *ERROR*.

**Aktionsergebnis (action result)**:
Das Ergebniswort eines Schritts, der etwas ändert (setup, integrate, update, rollback, uninstall): *OK*, *FAIL*, *WARN*, *SKIP* oder *INFO*.

**Ergebniszeile (verdict line)**:
Die Zeile, die einen Prüfbericht als Anzahl je Prüfergebnis zusammenfasst und einen Exit-Code ungleich null nennt.

**Verbindungsdaten (connection details)**:
Der Block, der einem manuell konfigurierten Client sagt, wie er den Proxy erreicht: Basis-URLs, Schlüssel, Modell-IDs und der Zustand des Proxys.

**Zeilenmodus (line mode)**:
Jede Ausgabe außer der Vollbild-TUI des Proxys: einfache Zeilen ohne Rahmen.

**Proxy-TUI (proxy TUI)**:
Die Vollbild-Terminalansicht des laufenden Proxys mit Statuskopf, Logbereich und Tastenhinweisen.

**Zeichenstufe (glyph tier)**:
Der Zeichensatz, den die Ausgabe auf einem bestimmten Terminal verwenden darf: *full*, *wgl4* oder *ascii*. Die Wörter sind auf allen Stufen gleich; nur die Symbole ändern sich.

## Unterstützung

**Mindestversion (support floor)**:
Die niedrigste Runtime-Version, die das Kit unterstützt: Node.js 24. Darunter brechen die Installer, `setup` und `update` ab, bevor sie etwas ändern.
