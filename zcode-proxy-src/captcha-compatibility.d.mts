export function inspectCaptchaScript(bytes: Buffer, fetchedAt?: number | null): Readonly<{
  sha256: string;
  fetchedAt: number | null;
  markers: Readonly<{
    initAliyunCaptcha: boolean;
    startTracelessVerification: boolean;
    show: boolean;
  }>;
}>;
