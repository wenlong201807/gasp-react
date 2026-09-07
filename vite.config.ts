import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** sw.js 中等待构建注入的版本占位符（replaceAll 全量替换，注释中不得出现同名字面量） */
const SW_VERSION_TOKEN = '__SW_VERSION__';

/** 递归收集 public/ 下文件的相对路径（posix 风格）：public 文件不进 rollup bundle，需单独并入 manifest */
function collectPublicFiles(dir: string, base = ''): string[] {
	const files: string[] = [];
	for (const name of fs.readdirSync(dir)) {
		const rel = base ? `${base}/${name}` : name;
		const abs = path.join(dir, name);
		if (fs.statSync(abs).isDirectory()) files.push(...collectPublicFiles(abs, rel));
		else files.push(rel);
	}
	return files;
}

/**
 * 自研 SW 清单插件（零第三方依赖）：
 * - writeBundle：产物 bundle（此时才包含 index.html——generateBundle 早于 vite 核心 html 产出）
 *   + public 文件汇总为 dist/sw-manifest.json，version = 全部文件名拼接的 sha256 前 12 位
 *   （产物名带内容 hash，内容变 → 名变 → version 变）
 * - 同一钩子内把 version 注入 dist/sw.js 占位符：registration.update() 只按 sw.js 字节比对，
 *   不注入版本则更新提示永远无法触发
 */
function swManifestPlugin(): Plugin {
	return {
		name: 'sw-manifest',
		writeBundle(_options, bundle) {
			const distDir = path.resolve(__dirname, 'dist');
			const publicDir = path.resolve(__dirname, 'public');
			const publicFiles = fs.existsSync(publicDir) ? collectPublicFiles(publicDir) : [];
			const all = [...Object.keys(bundle), ...publicFiles].filter(
				(file) => file !== 'sw-manifest.json' && file !== 'sw.js'
			);
			// indexOf 去重（避免 Set 展开触发 TS2802 downlevelIteration 限制）
			const assets = all.filter((file, i) => all.indexOf(file) === i).sort();
			const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
			fs.writeFileSync(
				path.join(distDir, 'sw-manifest.json'),
				`${JSON.stringify({ version, assets }, null, 2)}\n`
			);

			const swPath = path.join(distDir, 'sw.js');
			if (!fs.existsSync(swPath)) return;
			const source = fs.readFileSync(swPath, 'utf-8');
			if (source.includes(SW_VERSION_TOKEN)) {
				// split/join 全量替换（replaceAll 需 es2021 lib，本仓库 tsconfig lib 更低）
				fs.writeFileSync(swPath, source.split(SW_VERSION_TOKEN).join(version));
			}
		},
	};
}

export default defineConfig({
	plugins: [react(), swManifestPlugin()],
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
					'three-vendor': ['three'],
				},
			},
		},
	},
});
