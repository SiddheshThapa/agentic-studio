import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agentic Studio",
  description: "AI studio operations platform — compliance, analysis, and release scheduling agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: extensions (Grammarly et al) inject attributes onto <body> before hydration */}
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-ink-950 text-ink-100">
        {children}
      </body>
    </html>
  );
}
