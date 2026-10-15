import type { Metadata } from "next";
import "./globals.css";
import "../components/workbench/workspace-frame.css";
import { WorkspaceFrame } from "../components/workbench/workspace-frame";
import { getChatGPTUser } from "./chatgpt-auth";

export const metadata: Metadata = {
  title: "Dublin Tech Compass",
  description:
    "A private, sourced research workbench for finding technology employers in County Dublin.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getChatGPTUser();

  return (
    <html lang="en">
      <body className="antialiased">
        {user ? (
          <WorkspaceFrame user={user}>{children}</WorkspaceFrame>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
