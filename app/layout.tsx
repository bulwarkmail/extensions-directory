import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { NavHeader } from "@/components/nav-header";
import { Footer } from "@/components/footer";
import { ThemeProvider } from "@/components/theme-provider";

// One family for everything and a mono for code, as on bulwarkmail.org.
// Hanken Grotesk is a variable font, so one file covers 400, 500 and 600.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://extensions.bulwarkmail.org";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Bulwark Extensions — Plugins and themes for Bulwark Webmail",
    template: "%s — Bulwark Extensions",
  },
  description:
    "Discover free and open source plugins and themes for Bulwark Webmail. Extend functionality, customize the interface, and make the client your own.",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Bulwark Extensions",
    title: "Bulwark Extensions — Plugins and themes for Bulwark Webmail",
    description:
      "Discover free and open source plugins and themes for Bulwark Webmail.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bulwark Extensions",
    description:
      "Discover free and open source plugins and themes for Bulwark Webmail.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${hanken.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
        {process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ? (
          <script
            defer
            src={process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL ?? "https://umami.bulwarkmail.org/script.js"}
            data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
          />
        ) : null}
      </head>
      {/* The font variables sit on <html> because the tokens in globals.css
          resolve them on :root. */}
      <body className="min-h-screen flex flex-col antialiased">
        <ThemeProvider>
          <NavHeader />
          <main className="flex-1">{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}
