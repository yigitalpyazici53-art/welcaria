export default function Home() {
  return (
    <main style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>RapidFlow Plumbing — AI Receptionist</h1>
      <p>Webhook endpoint: <code>POST /api/twilio/incoming-sms</code></p>
      <p>Status: <strong>Online</strong></p>
    </main>
  );
}
