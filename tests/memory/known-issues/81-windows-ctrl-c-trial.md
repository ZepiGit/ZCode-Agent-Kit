# 81 Windows Ctrl-C trial does not send a console event

Check: `stale-lock-after-ctrl-c` (Windows S4/short).

The Windows trial ends the starting process with `child.kill("SIGINT")`, which
Node maps to `TerminateProcess`. That is a crash, not Ctrl-C, so no handler
runs and the start lock stays behind until the next start takes it over. The
kit behaves as designed; the trial has to deliver a real console control
event before this check can turn GREEN.
