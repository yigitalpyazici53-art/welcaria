export interface MetaApiError {
  message: string;
  type?: string;
  code?: number;
  fbtrace_id?: string;
}

export class MetaWhatsAppError extends Error {
  status: number;
  metaError?: MetaApiError;

  constructor(status: number, metaError?: MetaApiError) {
    const detail = metaError?.message ? ` — ${metaError.message}` : "";
    super(`Meta WhatsApp API error: ${status}${detail}`);
    this.name = "MetaWhatsAppError";
    this.status = status;
    this.metaError = metaError;
  }
}

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
    let metaError: MetaApiError | undefined;
    try {
      const json = await response.json() as { error?: MetaApiError };
      if (json?.error) metaError = json.error;
    } catch {
      // ignore parse failure
    }
    console.error(
      `[MetaWhatsApp] Send failed: ${response.status} code=${metaError?.code ?? "?"} type=${metaError?.type ?? "?"} msg=${metaError?.message ?? "(unknown)"}`
    );
    throw new MetaWhatsAppError(response.status, metaError);
  }

  const data = await response.json().catch(() => null) as { messages?: Array<{ id: string }> } | null;
  console.log(`[MetaWhatsApp] Sent to=${to} messageId=${data?.messages?.[0]?.id ?? "(unknown)"}`);
}
