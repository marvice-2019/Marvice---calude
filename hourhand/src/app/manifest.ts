import type { MetadataRoute } from "next";

// Makes Hourhand installable from the browser. Colours are the light-theme --hh-bg and --hh-accent.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hourhand",
    short_name: "Hourhand",
    description: "Your booking link, calendar and payments",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#fffdf8",
    theme_color: "#b4410e",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
