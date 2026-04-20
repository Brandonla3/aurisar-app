import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'portrait-render-api',
      configureServer(server) {
        server.middlewares.use('/api/request-render', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const avatarsDir = path.join(process.cwd(), 'public', 'avatars');
              const profile = JSON.parse(body);
              // Include the output dir so the UE script knows where to write
              profile.outputDir = avatarsDir.replace(/\\/g, '/') + '/';
              fs.writeFileSync(
                path.join(avatarsDir, 'render_request.json'),
                JSON.stringify(profile)
              );
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        });
      },
    },
  ],
  resolve: {
    // Ensure only one copy of React and Three.js exists — prevents
    // "Invalid hook call" when @react-three/fiber ships its own React copy.
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  build: {
    outDir: 'build',
  },
})
