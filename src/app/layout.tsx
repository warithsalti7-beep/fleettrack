import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FleetTrack - Taxi Fleet Management",
  description: "Professional taxi fleet management dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-gray-50 font-sans antialiased">{children}</body>
    </html>
  );
}
