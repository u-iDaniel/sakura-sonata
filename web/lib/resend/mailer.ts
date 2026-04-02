import { Resend } from "resend";

interface EmailData {
  to: string;
  subject: string;
  html: string;
  idempotencyKey?: string;
}

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(email: EmailData) {
  const { data, error } = await resend.emails.send(
    {
      from: process.env.EMAIL_SOURCE!,
      to: [email.to],
      subject: email.subject,
      html: email.html,
    },
    email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : undefined,
  );

  if (error) {
    console.error("Error sending email:", error);
    throw new Error(error.message);
  }

  return data;
}
