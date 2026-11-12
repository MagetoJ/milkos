import { Resend } from "resend";

let resendInstance: Resend | null = null;

export function getResend(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY environment variable.");
  }
  if (!resendInstance) {
    resendInstance = new Resend(process.env.RESEND_API_KEY);
  }
  return resendInstance;
}