import * as React from "react";

interface CooperativeActivationEmailProps {
  cooperativeName: string;
  activationToken: string;
}

export const CooperativeActivationEmail = ({
  cooperativeName,
  activationToken,
}: CooperativeActivationEmailProps) => {
  const activationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/activate?token=${activationToken}`;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f9fafb", padding: "40px 20px" }}>
      <div style={{ maxWidth: "560px", margin: "0 auto", backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e5e7eb", padding: "32px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "bold", color: "#111827", marginBottom: "16px" }}>
          Welcome to MilkOS
        </h1>
        <p style={{ color: "#4b5563", fontSize: "15px", lineHeight: "1.5" }}>
          Hello <strong>{cooperativeName}</strong> Team,
        </p>
        <p style={{ color: "#4b5563", fontSize: "15px", lineHeight: "1.5" }}>
          Your cooperative space has been successfully created. Click the button below to complete registration and configure your initial admin credentials.
        </p>
        <div style={{ margin: "28px 0" }}>
          <a
            href={activationUrl}
            style={{
              backgroundColor: "#059669",
              color: "#ffffff",
              padding: "12px 24px",
              borderRadius: "6px",
              fontWeight: "bold",
              fontSize: "14px",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Activate Cooperative Account
          </a>
        </div>
        <p style={{ color: "#6b7280", fontSize: "12px", lineHeight: "1.4" }}>
          If the button does not work, copy and paste this URL into your browser:<br />
          <a href={activationUrl} style={{ color: "#059669" }}>{activationUrl}</a>
        </p>
      </div>
    </div>
  );
};