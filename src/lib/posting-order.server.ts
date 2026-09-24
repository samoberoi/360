/** Server-only helper that delivers the posting order email through Resend. */
export async function sendEmailViaResend(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ id: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) throw new Error("Email is not configured yet — the Resend API key is missing.");

  const from =
    process.env["POSTING_ORDER_FROM"] ||
    "PLUS 360 FAHRENHEIT SOLUTIONS <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    console.error(`Resend send failed [${res.status}]: ${bodyText}`);
    // Sandbox mode: an unverified sender domain can only deliver to the
    // provider account owner. Surface that plainly instead of raw JSON.
    if (res.status === 403 && bodyText.includes("your own email address")) {
      throw new Error(
        "Email sending is still in test mode — a company sender domain must be verified before work orders can reach employees.",
      );
    }
    throw new Error(`Email provider rejected the request [${res.status}]: ${bodyText}`);
  }

  try {
    const parsed = JSON.parse(bodyText) as { id?: string };
    return { id: parsed.id ?? "" };
  } catch {
    return { id: "" };
  }
}
