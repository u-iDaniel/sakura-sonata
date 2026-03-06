import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { sendEmail } from "./aws/mailer";
import { after } from "next/server";
import { getVerificationEmailHtml } from "./email-templates/verify";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }, request) => {
      // Run asynchronously to prevent timing attacks (runs after the response is sent, so attackers can't measure response time differences to check if an email exists or not)
      // after() ensures that serverless functions continue running even after the response is sent
      after(
        sendEmail({
          to: user.email,
          subject: "Verify your email for Sakura Sonata",
          html: getVerificationEmailHtml(url),
        }),
      );
    },
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24 hours in seconds
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
});
