import { ImageResponse } from "next/og";

// The preview card LinkedIn, Slack, etc. show when someone shares the site (1200×630 is the standard size).
export const alt = "Payment Decision Lab: same payment, same data, different answers. Can an AI decision model route payments better than rules?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#1a1a19",
          color: "#f1f5f9",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, color: "#94a3b8" }}>PAYMENT DECISION LAB</div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>Same payment. Same data.</div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, color: "#f08ab8" }}>Different answers.</div>
          <div style={{ display: "flex", marginTop: 32, fontSize: 34, color: "#cbd5e1" }}>
            Can an AI decision model route payments better than rules?
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 26, color: "#94a3b8" }}>
          <div style={{ display: "flex" }}>jev-orchestrator.serkandogantekin.com</div>
          <div
            style={{
              display: "flex",
              padding: "8px 18px",
              borderRadius: 999,
              border: "2px solid rgba(245, 158, 11, 0.5)",
              background: "rgba(69, 26, 3, 0.9)",
              color: "#fcd34d",
            }}
          >
            Simulation only
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
