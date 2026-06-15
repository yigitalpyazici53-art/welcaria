export async function sendWhatsAppText(to: string, body: string): Promise<void> {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.META_GRAPH_API_VERSION ?? "v21.0";

  if (!token || !phoneNumberId) {
    throw new Error(
      "META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID must be set to send WhatsApp messages"
    );
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "(unreadable)");
    console.error(`[MetaWhatsApp] Send failed: ${response.status} — ${errorText}`);
    throw new Error(`Meta WhatsApp API error: ${response.status}`);
  }

  const data = await response.json().catch(() => null) as { messages?: Array<{ id: string }> } | null;
  console.log(`[MetaWhatsApp] Sent to=${to} messageId=${data?.messages?.[0]?.id ?? "(unknown)"}`);
}
