import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Privora MCP",
  description: "Review provider policy changes and inspect MCP transfer decisions.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={GeistSans.variable + " " + GeistMono.variable}><body>{children}</body></html>;
}
