import type { Metadata } from "next";
import { Oswald, Source_Sans_3, Geist_Mono } from "next/font/google";
import "./globals.css";

// Display face: condensed, poster-like — headings and hero type only (see
// globals.css, which routes text-display/heading/title through this family).
const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Body/UI face: Adobe's own open-source relative of the spec'd (non-embeddable)
// Acumin Pro — everything read at length or small.
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
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
      className={`dark ${oswald.variable} ${sourceSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning on both tags: browser extensions (Grammarly,
          password managers, etc.) inject attributes onto <html> and <body>
          before hydration runs, which isn't a real server/client mismatch */}
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-ink-950 text-ink-100">
        {children}
      </body>
    </html>
  );
}
