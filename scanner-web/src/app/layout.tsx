import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const poppins = localFont({
    src: [
        { path: "./fonts/Poppins-Regular.ttf", weight: "400", style: "normal" },
        { path: "./fonts/Poppins-Bold.ttf", weight: "700", style: "normal" },
    ],
    variable: "--font-poppins",
});

const britanica = localFont({
    src: "./fonts/Britanica-SemiExpanded-Heavy.ttf",
    weight: "900",
    variable: "--font-britanica",
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "INGRESADOS | Control de Inventario",
    description: "Plataforma inteligente de escaneo y control de bodega",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="es">
            <body
                className={`${poppins.variable} ${britanica.variable} ${geistMono.variable} antialiased`}
            >
                {children}
            </body>
        </html>
    );
}
