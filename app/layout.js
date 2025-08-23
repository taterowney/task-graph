import "./globals.css";

export const metadata = {
  title: "Task Graph",
  description: "",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <title>Tate Rowney</title>
        <link rel="stylesheet" href="https://use.typekit.net/kll8mmd.css" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png" />
        {/* <link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png" /> */}
        <link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png" />
        <link rel="manifest" href="/favicons/site.webmanifest" />
        <link rel="mask-icon" href="/favicons/safari-pinned-tab.svg" color="#5bbad5" />
        <script src="https://accounts.google.com/gsi/client" async defer></script>
        <meta name="msapplication-TileColor" content="#da532c" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body
        style={{
          margin: 0,
          backgroundColor: 'rgba(255,255,255,0.8)',
          fontFamily: 'futura-pt, sans-serif',
          fontWeight: 300,
          fontSize: '16px',
          overflowX: 'hidden',
        }}
      >
        {children}
      </body>
    </html>
  );
}