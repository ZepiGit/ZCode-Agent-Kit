# 74 MCP bridge growth in the short profile

Check: `growth:mcp-bridge` (S5/short). Linux lists it as flipping; Windows
lists it as `unstable` with a bounded growth band.

Task retention in the MCP bridge is bounded (500 tasks, 7 days) and covered by
the bridge's own tests. The short memory profile ends before that bound is
reached, so the growth check cannot tell a working bound from a missing one.
The open question is which measurement can, and until it is answered the
entry stays listed.
