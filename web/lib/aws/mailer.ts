import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

interface EmailData {
  to: string;
  subject: string;
  html: string;
}

const sesClient = new SESClient({
  region: process.env.AWS_REGION,
});

export async function sendEmail(email: EmailData) {
  const cmd = new SendEmailCommand({
    Destination: {
      ToAddresses: [email.to],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: email.html,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: email.subject,
      },
    },
    Source: process.env.EMAIL_SOURCE!,
    ConfigurationSetName: "auth-emails", // an configuration set that doesn't track the user (was set up in AWS console to bypass the default configuration set)
  });

  try {
    return sesClient.send(cmd);
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}
