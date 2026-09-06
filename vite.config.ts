import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	server: {
		port: 5173,
		host: true,
	},
	build: {
		target: 'esnext',
		minify: 'esbuild',
		cssCodeSplit: true,
		rollupOptions: {
			output: {
				manualChunks: {
					'react-vendor': ['react', 'react-dom'],
					'gsap-vendor': ['gsap'],
					'lottie-vendor': ['lottie-react'],
				},
			},
		},
	},
});
