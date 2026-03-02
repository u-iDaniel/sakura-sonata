import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Fasthand } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.BETTER_AUTH_URL
    ? process.env.BETTER_AUTH_URL
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Sakura Sonata",
  description: "Free animated beginner friendly piano tutorials in seconds!",
  openGraph: {
    title: "Sakura Sonata - A Piano Tutorial Generator",
    description: "Free animated beginner friendly piano tutorials in seconds!",
    url: defaultUrl,
    images: [
      {
        url: "https://i.postimg.cc/Fz5b5Hnq/opengraph-image.png",
        width: 1200,
        height: 600,
        alt: "Sakura Sonata - Piano visualization tutorial",
      },
    ],
    type: "website",
  },
};

const inter = Inter({
  variable: "--font-inter",
  display: "swap",
  subsets: ["latin"],
});

const fasthand = Fasthand({
  variable: "--font-fasthand",
  weight: "400",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${fasthand.variable} ${inter.className} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
