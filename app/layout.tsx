import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AzusaTrade | Market Terminal",
  description: "Analisis pasar, pantau berita ekonomi, dan uji indikator dalam satu workspace.",
  icons: { icon: "/azusa.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
