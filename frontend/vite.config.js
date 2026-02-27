import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': {
                target: 'http://10.217.4.11:8000',
                changeOrigin: true,
            },
        },
    },
})
