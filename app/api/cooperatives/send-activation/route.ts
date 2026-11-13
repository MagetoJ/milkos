import { NextResponse } from "next/server";
import { getResend } from "@/lib/email/resend";
import { CooperativeActivationEmail } from "@/components/emails/CooperativeActivation";

export async function POST(req: Request) {
  try {
    const { cooperativeEmail, cooperativeName, activationToken } = await req.json();

    if (!cooperativeEmail || !cooperativeName || !activationToken) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const resend = getResend();

    // Default domain during testing is 'onboarding@resend.dev'
    // Replace with your verified domain (e.g., 'onboarding@milkos.app') once configured in Resend.
    const sender = process.env.NODE_ENV === "production"
      ? "MilkOS Onboarding <onboarding@milkos.app>"
      : "MilkOS Onboarding <onboarding@resend.dev>";

    const { data, error } = await resend.emails.send({
      from: sender,
      to: [cooperativeEmail],
      subject: `Activate Your Cooperative Account — ${cooperativeName}`,
      react: CooperativeActivationEmail({ cooperativeName, activationToken }),
    });

    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: errMessage || "Internal server error" }, { status: 500 });
  }
}