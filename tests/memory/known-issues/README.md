# Known memory-loop issues

`../expected-red.json` lists the memory-loop runs that are expected to be RED
today. Every entry names the issue that owns the failing checks by its
two-digit id, and each id needs a note in this directory (`NN-<slug>.md`).
The ratchet in `../lib/ratchet.mjs` refuses an entry whose id has no note.

An entry leaves the list when its checks are fixed and stay GREEN. A check
marked `flips` is RED only in some runs; it stays listed until ten CI runs in
a row are GREEN on that leg.
