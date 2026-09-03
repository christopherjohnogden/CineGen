import type { Metadata } from "next";
import "./globals.css";

const siteTitle = "CineGen — AI Film Production Studio";
const siteDescription =
  "A shared AI film production studio for planning, generating, editing, and finishing films together.";

export const metadata: Metadata = {
  metadataBase: new URL("https://cinegen-team.cogden.chatgpt.site"),
  title: siteTitle,
  description: siteDescription,
  alternates: { canonical: "/" },
  icons: {
    icon: "/cinegen-icon.png",
    shortcut: "/cinegen-icon.png",
    apple: "/cinegen-icon.png",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "CineGen",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "CineGen — AI Film Production Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/og.png"],
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
