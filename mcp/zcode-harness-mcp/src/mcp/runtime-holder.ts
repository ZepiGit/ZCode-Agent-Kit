/**
 * Process-wide holder for the RuntimeManager so resource handlers can reach
 * it without circular imports.
 */
import type { RuntimeManager } from "../runtime/manager.js";

class Holder {
  private instance: RuntimeManager | null = null;

  set(rt: RuntimeManager): void {
    this.instance = rt;
  }

  get(): RuntimeManager {
    if (this.instance === null) throw new Error("RuntimeManager not initialized");
    return this.instance;
  }
}

export const RuntimeManagerHolder = new Holder();
