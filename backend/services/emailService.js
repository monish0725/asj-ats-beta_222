// Email provider abstraction. The rest of the app only ever calls sendOtpEmail() — it never
// touches a specific provider's SDK/API directly. This makes swapping providers (Brevo →
// SendGrid → SES) a one-file change.
//
// EMAIL_PROVIDER=brevo   -> sends real email via Brevo's transactional email API
// EMAIL_PROVIDER=console -> logs the email to the console instead of sending (dev/local default)

const PROVIDER = process.env.EMAIL_PROVIDER || "console";
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || "no-reply@example.com";
const FROM_NAME = process.env.EMAIL_FROM_NAME || "ASJ Recruitment ATS";

async function sendViaBrevo({ to, subject, html }) {
  const apiKey = process.env.EMAIL_API_KEY;
  if (!apiKey) {
    throw new Error("EMAIL_API_KEY is not set, but EMAIL_PROVIDER=brevo. Add your Brevo API key to .env.");
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_ADDRESS },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Brevo send failed (HTTP ${response.status}): ${body.slice(0, 300)}`);
  }

  const data = await response.json().catch(() => ({}));
  return { provider: "brevo", messageId: data.messageId || null };
}

async function sendViaConsole({ to, subject, html }) {
  console.log("\n──────── DEV EMAIL (EMAIL_PROVIDER=console) ────────");
  console.log("To:      ", to);
  console.log("Subject: ", subject);
  console.log("Body:\n", html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  console.log("─────────────────────────────────────────────────────\n");
  return { provider: "console", messageId: null };
}

async function sendEmail({ to, subject, html }) {
  switch (PROVIDER) {
    case "brevo":
      return sendViaBrevo({ to, subject, html });
    case "console":
      return sendViaConsole({ to, subject, html });
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${PROVIDER}". Use "brevo" or "console".`);
  }
}

export async function sendOtpEmail(to, code, expiryMinutes) {
  const subject = "Your ASJ Recruitment ATS sign-in code";
  const html = `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #101828;">
      <p style="font-size: 13px; font-weight: 700; letter-spacing: .04em; color: #0097a7; text-transform: uppercase; margin: 0 0 4px;">ASJ Recruitment ATS</p>
      <h1 style="font-size: 22px; margin: 0 0 18px;">Your sign-in code</h1>
      <p style="font-size: 14px; color: #475467; margin: 0 0 20px;">Enter this code to finish signing in. It expires in ${expiryMinutes} minutes.</p>
      <div style="font-size: 34px; font-weight: 800; letter-spacing: .12em; background: #f3f5f8; border-radius: 10px; padding: 18px 0; text-align: center; margin-bottom: 20px;">${code}</div>
      <p style="font-size: 12.5px; color: #6b7280; margin: 0;">If you didn't request this code, you can safely ignore this email.</p>
    </div>
  `;
  return sendEmail({ to, subject, html });
}
