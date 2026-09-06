import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Hub · клуб Марії", description: "Панель керування спільнотою" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="uk"><body>{children}</body></html>);
}
