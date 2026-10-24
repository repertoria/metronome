import type { CapacitorConfig } from '@capacitor/cli'

// Live reload: `mise run android:live` sets CAP_SERVER_URL to the Vite dev server.
const url = process.env.CAP_SERVER_URL

const config: CapacitorConfig = {
  appId: 'org.repertoria.metronome',
  appName: 'Metronome',
  webDir: 'dist',
  plugins: {
    SystemBars: {
      // Pad the WebView on older WebViews, edge-to-edge with env(safe-area-*) on newer.
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
    },
  },
  ...(url && { server: { url, cleartext: true } }),
}

export default config
