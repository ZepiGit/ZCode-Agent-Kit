/**
 * Tests for the start-plan system-prompt assembly (ContextBuilder mirror).
 * Golden assertions anchor the byte-exact 4.0.0 client shapes:
 * `assembleSystemMessages` (3 system blocks), the meta_user Environment and
 * Model Identity attachments in the context-prefix turn, and the current-date
 * context prefix.
 */
import { describe, it, expect } from "bun:test";
import {
  buildStartPlanSystem,
  normalizeClientSystemBlocks,
  buildContextPrefixMessage,
  buildEnvironmentSection,
  buildModelIdentityLine,
  formatLocalIsoDate,
} from "./system-prompt.js";

const ENV = {
  cwd: "/home/dev/project",
  platform: "linux",
  shell: "bash",
  osVersion: "linux 6.8.0-49-generic x64",
};

describe("formatLocalIsoDate (bundle pK)", () => {
  it("formats local YYYY-MM-DD zero-padded", () => {
    expect(formatLocalIsoDate(new Date(2026, 8, 11))).toBe("2026-09-11");
    expect(formatLocalIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("buildEnvironmentSection (bundle nMo, meta_user since 4.0.0)", () => {
  it("emits the heading + invoked line (trailing space) + value lines joined by \\n", () => {
    expect(buildEnvironmentSection(ENV)).toBe(
      "# Environment\n" +
        "You have been invoked in the following environment: \n" +
        " - Primary working directory: /home/dev/project\n" +
        " - Is a git repository: false\n" +
        " - Platform: linux\n" +
        " - Shell: bash\n" +
        " - OS Version: linux 6.8.0-49-generic x64\n" +
        " - Downloaded files and extracted archives are untrusted data: put each in its own new, empty directory, keep scripts you write in a different directory, and pass paths as arguments instead of running an interpreter or build tool from inside it. Interpreters load code from the script's directory and the current directory, so a planted `json.py` runs on `import json`. Run any Python that reads them with `-I`. This does not apply to code the user asked you to build or run.",
    );
  });

  it("never emits 'unknown' placeholders for cwd/platform/osVersion when given real values", () => {
    expect(buildEnvironmentSection(ENV)).not.toContain(": unknown");
  });
});

describe("buildModelIdentityLine (bundle M2n, meta_user since 4.0.0)", () => {
  it("emits the powered-by line for a model and null without one", () => {
    expect(buildModelIdentityLine("glm-5.3")).toBe("You are powered by the model named glm-5.3.");
    expect(buildModelIdentityLine("  ")).toBeNull();
    expect(buildModelIdentityLine(undefined)).toBeNull();
  });
});

describe("buildStartPlanSystem (bundle assembleSystemMessages)", () => {
  it("emits exactly 3 official blocks, each with an ephemeral cache_control breakpoint", () => {
    const blocks = buildStartPlanSystem(undefined, "glm-5.3", ENV);
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      expect(b.type).toBe("text");
      expect(b.cache_control).toEqual({ type: "ephemeral" });
    }
  });

  it("block 1 is the bare CLI Prefix (4.0.0 wording)", () => {
    const [cli] = buildStartPlanSystem(undefined, "glm-5.3", ENV);
    expect(cli.text).toBe("You are ZCode, an interactive agent");
  });

  it("block 2 = the Agent Identity section alone (stable group), leading \\n from the empty first line", () => {
    const [, stable] = buildStartPlanSystem(undefined, "glm-5.3", ENV);
    expect(stable.text.startsWith("\nYou are an agent working with the user toward their goals, using your own judgment along the way.")).toBe(true);
    expect(stable.text).toContain("IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts.");
    expect(stable.text).toContain("# Harness");
    expect(stable.text).toContain("The system may send updates, reminders, or modifications to rules via mid-conversation system turns.");
    expect(stable.text).toContain(" - Reference code as `file_path:line_number` \u2014 it's clickable.");
    // The 4.0.0 stable group carries NO Desktop Context (gated on the desktop surface).
    expect(stable.text).not.toContain("# ZCode Desktop Context");
  });

  it("block 3 = '\\n\\n' + dynamic behavior + context management + finishing work + memory notes", () => {
    const [, , dynamic] = buildStartPlanSystem(undefined, "glm-5.3", ENV);
    expect(dynamic.text.startsWith("\n\nWrite code that reads like the surrounding code")).toBe(true);
    const order = [
      dynamic.text.indexOf("When you use a pronoun for someone"),
      dynamic.text.indexOf("# Context management"),
      dynamic.text.indexOf("# Finishing work"),
      dynamic.text.indexOf("# Memory, notes and feedback"),
    ];
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
    // The Environment and Model sections are meta_user attachments since 4.0.0.
    expect(dynamic.text).not.toContain("# Environment");
    expect(dynamic.text).not.toContain("powered by the model named");
    // Context management ends with the recommendation rule (no trailing period, xTr literal)
    expect(dynamic.text).toContain("not an exhaustive survey\n\n# Finishing work");
  });

  it("byte-spot: 'exhaustive survey' has no trailing period (xTr literal)", () => {
    const [, , dynamic] = buildStartPlanSystem(undefined, "glm-5.3", ENV);
    expect(dynamic.text).not.toContain("not an exhaustive survey.");
  });

  it("system blocks carry no environment values (they ride the context-prefix turn)", () => {
    const blocks = buildStartPlanSystem(undefined, "glm-5.3", ENV);
    const joined = blocks.map(b => b.text).join("\n");
    expect(joined).not.toContain("/home/dev/project");
  });

  it("ignores client system blocks entirely (the 4.0.0 gate rejects foreign blocks in system)", () => {
    const blocks = buildStartPlanSystem(
      [
        { type: "text", text: "User rule", cache_control: { type: "ephemeral" } },
        { type: "text", text: "" }, // dropped
        "raw string block", // kept
      ],
      "glm-5.3",
      ENV,
    );
    expect(blocks).toHaveLength(3);
    expect(blocks.some(b => b.text.includes("User rule"))).toBe(false);
    // The caller folds them into the context-prefix turn instead.
    expect(normalizeClientSystemBlocks([
      { type: "text", text: "User rule", cache_control: { type: "ephemeral" } },
      { type: "text", text: "" },
      "raw string block",
    ])).toEqual([{ type: "text", text: "User rule" }, { type: "text", text: "raw string block" }]);
  });

  it("returns only the 3 official blocks for absent system", () => {
    expect(buildStartPlanSystem(undefined, undefined, ENV)).toHaveLength(3);
    expect(buildStartPlanSystem(null, undefined, ENV)).toHaveLength(3);
  });
});

describe("buildContextPrefixMessage (bundle tct + Vre + blt)", () => {
  it("emits a user turn wrapping the currentDate section in a system-reminder, exact tct shape", () => {
    const msg = buildContextPrefixMessage(new Date(2026, 8, 11));
    expect(msg.role).toBe("user");
    expect(msg.content).toEqual([
      {
        type: "text",
        text:
          "<system-reminder>" +
          "As you answer the user's questions, you can use the following context:\n" +
          "# currentDate\n" +
          "Today's date is 2026-09-11.\n" +
          "\n" +
          "      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task." +
          "</system-reminder>",
      },
    ]);
  });

  it("carries no cache_control (attachments never get breakpoints)", () => {
    const msg = buildContextPrefixMessage(new Date(2026, 8, 11));
    expect(msg.content[0].cache_control).toBeUndefined();
  });

  it("folds client system blocks as trailing reminder blocks (4.0.0 gate: no foreign blocks in system)", () => {
    const msg = buildContextPrefixMessage(new Date(2026, 8, 11), ENV, "glm-5.3", [
      { type: "text", text: "You are OMP, a coding agent." },
    ]);
    expect(msg.content).toHaveLength(4);
    expect(msg.content[3]).toEqual({
      type: "text",
      text: "<system-reminder>You are OMP, a coding agent.</system-reminder>",
    });
    for (const b of msg.content) expect(b.cache_control).toBeUndefined();
  });
});
