export function getVerificationEmailHtml(verificationUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #fef2f2;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: #ffffff; padding: 40px 30px 25px; text-align: center;  border-bottom: 1px solid #e2e8f0;">
              <h1 style="margin: 0; color: #e8329c; font-size: 32px; font-weight: 600; letter-spacing: -0.5px; font-family: 'Segoe Script', cursive;">
                🌸 Sakura Sonata
              </h1>
              <h2 style="margin: 10px 0 0; color: #2d3142; font-size: 16px; opacity: 0.9;">
                Free animated piano visualizations for engaging practice sessions
              </h2>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 20px 30px 40px;">
              <h3 style="margin: 0 0 16px; color: #2d3142; font-size: 24px; font-weight: 600;">
                Welcome aboard! 🎹
              </h3>
              
              <p style="margin: 0 0 24px; color: #64748b; font-size: 16px; line-height: 1.6;">
                Thank you for signing up for <strong style="color: #ec4899;">Sakura Sonata</strong>! We're excited to help you on your musical journey.
              </p>
              
              <p style="margin: 0 0 32px; color: #64748b; font-size: 16px; line-height: 1.6;">
                To get started, please verify your email address by clicking the button below:
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center; padding: 0 0 32px;">
                    <a href="${verificationUrl}" style="display: inline-block; background: linear-gradient(94.88deg, #FFA2D0 0.62%, #FF70BB 99.37%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(251, 113, 133, 0.3);">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 16px; color: #94a3b8; font-size: 14px; line-height: 1.6;">
                Or enter this link into your browser:
              </p>
              
              <p style="margin: 0 0 32px; padding: 16px; background-color: #f8fafc; border-radius: 8px; color: #64748b; font-size: 14px; word-break: break-all; border: 1px solid #e2e8f0;">
                <span style="color: #64748b;">${verificationUrl}</span>
              </p>
              
              <div style="border-top: 1px solid #e2e8f0; padding-top: 24px; margin-top: 24px;">
                <p style="margin: 0 0 8px; color: #94a3b8; font-size: 13px; line-height: 1.5;">
                  This link will expire in <strong style="color: #64748b;">24 hours</strong>.
                </p>
                <p style="margin: 0; color: #94a3b8; font-size: 13px; line-height: 1.5;">
                  If you did not create an account, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 8px; color: #94a3b8; font-size: 14px;">
                Happy practicing! 🎵
              </p>
              <p style="margin: 0; color: #a9b8cc; font-size: 12px;">
                © ${new Date().getFullYear()} Sakura Sonata. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
