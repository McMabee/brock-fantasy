import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Brock Fantasy</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="dark light" />
        <ScrollViewStyleReset />
        <link rel="stylesheet" href="/ui/theme.css" />
        <link
          rel="preload"
          href="/ui/fonts/barlow-2.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script src="/ui/theme.js" />
        <script src="/ui/help-menu.js" defer />
      </head>
      <body>{children}</body>
    </html>
  );
}
