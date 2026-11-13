"use client";

import { useState } from "react";
import { Mail, CheckCircle, AlertCircle } from "lucide-react";

export interface SendActivationButtonProps {
  cooperativeEmail: string;
  cooperativeName: string;
  activationToken: string;
}

export function SendActivationButton({
  cooperativeEmail,
  cooperativeName,
  activationToken,
}: SendActivationButtonProps) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/cooperatives/send-activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cooperativeEmail,
          cooperativeName,
          activationToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to send email");
      }

      setSent(true);
    } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : "Something went wrong";
      setError(errMessage || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleSend}
        disabled={loading || sent}
        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
      >
        {sent ? (
          <>
            <CheckCircle className="w-3.5 h-3.5" /> Email Sent
          </>
        ) : (
          <>
            <Mail className="w-3.5 h-3.5" /> {loading ? "Sending..." : "Send Activation"}
          </>
        )}
      </button>
      {error && (
        <span className="flex items-center gap-1 text-[10px] text-red-600">
          <AlertCircle className="w-3 h-3" /> {error}
        </span>
      )}
    </div>
  );
}