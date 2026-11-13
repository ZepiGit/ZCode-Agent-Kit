/**
 * Answering a permission request: the option the operator chose is sent to
 * the runtime as an approval only when it is known to approve. An option
 * the bridge cannot classify with certainty is refused with an error and
 * nothing is sent; it is never treated as an approval.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InteractionManager } from "../../dist/interactions/manager.js";
import { JsonStore } from "../../dist/store/store.js";

function manager(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zh-options-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new InteractionManager(new JsonStore(dir), "ask", [], 60);
}

/** A pending permission request offering `options`; returns its id. */
function ask(m, options) {
  const before = new Set(m.list("pending").map((r) => r.id));
  const decision = m.register({ method: "interaction/requestPermission", harnessParams: { toolName: "Write", options }, sessionId: null, workspace: null, taskId: null, readOnlyMode: false });
  assert.deepEqual(decision, { auto: null, needsAgent: true });
  return m.list("pending").find((r) => !before.has(r.id)).id;
}

const decisionOf = (m, options, optionId) => {
  const id = ask(m, options);
  const out = m.resolve(id, { optionId });
  return { id, out, decision: out.resolution?.decision ?? null };
};

test("the approving kinds the runtime offers are sent as allow, its refusing kinds as deny", (t) => {
  const m = manager(t);
  for (const kind of ["allow_once", "allow_always", "allow_project"]) {
    assert.equal(decisionOf(m, [{ optionId: "a", label: "A", kind }, { optionId: "d", label: "D", kind: "deny" }], "a").decision, "allow", kind);
  }
  for (const kind of ["deny", "deny_once", "deny_always", "reject", "reject_once", "reject_always", "cancel"]) {
    assert.equal(decisionOf(m, [{ optionId: "a", label: "A", kind: "allow_once" }, { optionId: "x", label: "X", kind }], "x").decision, "deny", kind);
  }
});

test("an option of a kind the bridge does not know is refused with an error, not approved; the request stays open", (t) => {
  const m = manager(t);
  for (const kind of ["abort", "skip", "allow", "approve", "allow_everything", "ALLOW_ONCE", "allow_once ", "not_allow_once", ""]) {
    const { id, out } = decisionOf(m, [{ optionId: "x", label: "X", kind }, { optionId: "d", label: "D", kind: "deny" }], "x");
    assert.match(out.error ?? "", /cannot tell whether option x \(kind ".*"\) approves or refuses.*nothing was sent/, JSON.stringify(kind));
    assert.equal(m.get(id).status, "pending", `kind ${JSON.stringify(kind)}: still pending`);
    // The operator can still refuse it.
    assert.equal(m.resolve(id, { cancel: true }).resolution.decision, "deny");
  }
});

test("an option without a kind is classified by its id, with the same certainty", (t) => {
  const m = manager(t);
  assert.equal(decisionOf(m, [{ optionId: "allow_once", label: "Allow once" }], "allow_once").decision, "allow");
  assert.equal(decisionOf(m, [{ optionId: "deny_once", label: "Deny once" }], "deny_once").decision, "deny");
  assert.equal(decisionOf(m, [{ optionId: "reject", label: "Reject" }], "reject").decision, "deny");
  for (const optionId of ["option-2", "yes", "ok", "proceed"]) {
    const { id, out } = decisionOf(m, [{ optionId, label: "Allow" }], optionId);
    assert.match(out.error ?? "", /cannot tell whether option/, optionId);
    assert.equal(m.get(id).status, "pending");
  }
});

test("a refusing kind wins over an approving id; an approving kind on a refusing id is refused with an error", (t) => {
  const m = manager(t);
  assert.equal(decisionOf(m, [{ optionId: "allow_once", label: "?", kind: "deny" }], "allow_once").decision, "deny");
  const { id, out } = decisionOf(m, [{ optionId: "deny_once", label: "?", kind: "allow_once" }], "deny_once");
  assert.match(out.error ?? "", /cannot tell whether option deny_once/);
  assert.equal(m.get(id).status, "pending");
});

test("an option that was not offered is still rejected by name, and cancel still denies", (t) => {
  const m = manager(t);
  const id = ask(m, [{ optionId: "allow_once", label: "Allow once", kind: "allow_once" }]);
  assert.match(m.resolve(id, { optionId: "allow_everything" }).error, /optionId must be one of: allow_once/);
  assert.deepEqual(m.resolve(id, { cancel: true }).resolution, { decision: "deny", reason: "cancelled by operator" });
});
