import './globals.css';
export const metadata = { title: 'whatdidyougetdone', description: 'Log what you wore, ate, did and learned.' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>);
}
