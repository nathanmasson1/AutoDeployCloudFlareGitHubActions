export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function requireString(value: unknown, label: string): string {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} e obrigatorio.`);
  return text;
}

export function cloudflareErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "Erro desconhecido da Cloudflare.";
  const record = payload as Record<string, unknown>;
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const messages = errors
    .map((error) => {
      if (error && typeof error === "object") {
        const record = error as Record<string, unknown>;
        const message = "message" in record ? String(record.message) : String(error);
        return record.code ? `${message} (code ${String(record.code)})` : message;
      }
      return String(error);
    })
    .filter(Boolean);
  return messages.join("; ") || "Erro desconhecido da Cloudflare.";
}
