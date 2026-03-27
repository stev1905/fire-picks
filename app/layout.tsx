import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SportNav } from "@/components/layout/SportNav";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AuthNav } from "@/components/layout/AuthNav";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fire Picks",
  description: "Daily MLB player stats, matchup analysis, and trending picks",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geistSans.variable} suppressHydrationWarning>
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <TooltipProvider>
            {/* Header */}
            <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
                {/* Brand */}
                <a href="/" className="flex items-center gap-2 shrink-0">
                  <span className="text-xl leading-none">🔥</span>
                  <span className="font-bold text-lg tracking-tight brand-text">
                    Fire Picks
                  </span>
                </a>

                <div className="w-px h-5 bg-border shrink-0" />

                {/* Sport nav */}
                <SportNav />

                {/* Right side */}
                <div className="ml-auto flex items-center gap-2">
                  <AuthNav />
                  <ThemeToggle />
                </div>
              </div>
            </header>

            {/* Page content */}
            <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
              {children}
            </main>

            {/* Footer */}
            <footer className="border-t border-border py-4 px-6 text-center text-xs text-muted-foreground">
              🔥 Fire Picks · Data via MLB Stats API · Synced daily at 9am EST
            </footer>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
