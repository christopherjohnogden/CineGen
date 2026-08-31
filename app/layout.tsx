import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CineGen Cloud",
  description: "A shared browser workspace for AI film production.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
