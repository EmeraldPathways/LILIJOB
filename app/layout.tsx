import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dublin Tech Compass",
  description:
    "A private, sourced research workbench for finding technology employers in County Dublin.",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
