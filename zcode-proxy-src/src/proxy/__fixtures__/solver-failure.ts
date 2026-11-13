// Synthetic backend only: no vendor/happy-dom code is imported or executed.
import { CaptchaSdkError, CaptchaLocalVerificationError } from "../captcha-token.js";
export async function solveTraceless({ scene }: { scene: string }): Promise<string> {
  const error = scene === "cleanup" ? new Error("synthetic prefix cleanup failed SyntheticWorkerCredential")
    : scene === "typed" ? new CaptchaSdkError("other")
    : scene === "local" ? new CaptchaLocalVerificationError("verify param too short (76 chars) — degraded result, refused")
    : new Error("synthetic failure");
  error.message += " | SyntheticWorkerCredential";
  throw error;
}
