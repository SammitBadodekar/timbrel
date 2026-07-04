export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "3rem", margin: 0 }}>Timbrel</h1>
      <p style={{ maxWidth: "32rem", color: "#666" }}>
        Open-source, fully-local stem separation and a multitrack studio. No
        cloud, no account — nothing leaves your device.
      </p>
      <p style={{ color: "#999", fontSize: "0.875rem" }}>
        Marketing site — coming in v0.4.
      </p>
    </main>
  );
}
