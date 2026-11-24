import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Privora MCP",
  description: "Review provider policy changes and inspect MCP transfer decisions.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
