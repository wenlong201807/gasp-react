/**
 * 页内像素采样工具（installInPageToolkit 序列化后在页面内执行，禁止引用模块作用域）。
 *
 * 关键点：three.js WebGLRenderer 默认 preserveDrawingBuffer=false，绘制缓冲在合成后被清空，
 * 因此必须在「同一帧、引擎渲染之后」drawImage。引擎的 setAnimationLoop 先于本工具注册，
 * RAF 回调按注册顺序执行 → 本工具的 tick 每帧排在引擎渲染之后，读到的就是当帧画面。
 *
 * 暴露 window.__tcn：
 *   cap(n, gapMs)              连拍 n 帧（间隔 gapMs），存入内部帧缓冲
 *   op(name, args)             对帧缓冲执行分析，返回 JSON 可序列化结果
 *   reset()                    清空帧缓冲
 */

export function installInPageToolkit() {
	if (window.__tcn) return 'already';
	const st = { cv: null, buf: null, bctx: null, frames: [], want: false, err: null };

	function pickCanvas() {
		let best = null;
		let bestArea = 0;
		for (const c of document.querySelectorAll('canvas')) {
			const area = (c.clientWidth || c.width) * (c.clientHeight || c.height);
			if (area > bestArea) {
				bestArea = area;
				best = c;
			}
		}
		return best;
	}

	function ensure() {
		if (!st.cv || !st.cv.isConnected) {
			st.cv = pickCanvas();
			st.buf = null;
		}
		if (!st.cv) throw new Error('no <canvas> found on page');
		if (!st.buf || st.buf.width !== st.cv.width || st.buf.height !== st.cv.height) {
			st.buf = document.createElement('canvas');
			st.buf.width = st.cv.width;
			st.buf.height = st.cv.height;
			st.bctx = st.buf.getContext('2d', { willReadFrequently: true });
		}
	}

	function tick() {
		if (st.want) {
			try {
				ensure();
				st.bctx.drawImage(st.cv, 0, 0);
				const img = st.bctx.getImageData(0, 0, st.buf.width, st.buf.height);
				st.frames.push({ w: st.buf.width, h: st.buf.height, data: img.data, t: performance.now() });
			} catch (e) {
				st.err = String((e && e.message) || e);
			}
			st.want = false;
		}
		requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	async function waitFrame() {
		const t0 = performance.now();
		while (st.want) {
			if (performance.now() - t0 > 4000) throw new Error('frame capture timeout (RAF stalled?)');
			await sleep(6);
		}
		if (st.err) {
			const e = st.err;
			st.err = null;
			throw new Error('capture failed: ' + e);
		}
	}

	async function cap(n, gapMs, append = false) {
		if (!append) st.frames.length = 0;
		for (let i = 0; i < n; i++) {
			st.want = true;
			await waitFrame();
			if (i < n - 1 && gapMs > 0) await sleep(gapMs);
		}
		return {
			count: st.frames.length,
			w: st.frames[0].w,
			h: st.frames[0].h,
			times: st.frames.map((f) => Math.round(f.t)),
		};
	}

	/* ---------------- 像素原语 ---------------- */

	function lum(f, x, y) {
		if (x < 0 || y < 0 || x >= f.w || y >= f.h) return 0;
		const i = ((y | 0) * f.w + (x | 0)) * 4;
		return (0.2126 * f.data[i] + 0.7152 * f.data[i + 1] + 0.0722 * f.data[i + 2]) / 255;
	}

	function rgb(f, x, y) {
		const i = ((y | 0) * f.w + (x | 0)) * 4;
		return [f.data[i], f.data[i + 1], f.data[i + 2]];
	}

	/** 谓词：dark 轮胎 / bright 文本·发光 / accent 青色 HUD / car 青色车漆 / nonbg 非洞底 */
	function makePred(kind, thr) {
		if (kind === 'dark') return (f, x, y) => lum(f, x, y) < thr;
		if (kind === 'bright') return (f, x, y) => lum(f, x, y) > thr;
		if (kind === 'accent') {
			return (f, x, y) => {
				const [r, g, b] = rgb(f, x, y);
				return b > 110 && g > 110 && r < g * 0.8 && r < b * 0.8;
			};
		}
		if (kind === 'car') {
			return (f, x, y) => {
				const [r, g, b] = rgb(f, x, y);
				return g > 120 && b > 120 && r < g * 0.72 && r < b * 0.72;
			};
		}
		if (kind === 'nonbg') {
			return (f, x, y) => {
				const [r, g, b] = rgb(f, x, y);
				return !(r < 40 && g < 40 && b < 60) && lum(f, x, y) > 0.08;
			};
		}
		if (kind === 'teal') {
			// 360° 视口内的车漆：中等亮度青色，排除亮青 HUD 环（lum 高）与洞底暗紫（lum 低）
			return (f, x, y) => {
				const [r, g, b] = rgb(f, x, y);
				const l = lum(f, x, y);
				return g >= 80 && b >= 90 && r < g * 0.75 && l > 0.14 && l < 0.55;
			};
		}
		if (kind === 'carBody') {
			// 360° 视口内的车身：偏蓝（b-r 大）且不亮 —— 洞底是紫（b-r≈20）、HUD 环是亮青（lum 高），
			// 车身在暗环境中呈蓝灰（b-r≈50）
			return (f, x, y) => {
				const [r, g, b] = rgb(f, x, y);
				return b - r >= 35 && lum(f, x, y) <= 0.4;
			};
		}
		throw new Error('unknown pred ' + kind);
	}

	function clampBox(b) {
		return {
			x0: Math.max(0, Math.round(b.x0)),
			y0: Math.max(0, Math.round(b.y0)),
			x1: Math.min(st.frames[0].w - 1, Math.round(b.x1)),
			y1: Math.min(st.frames[0].h - 1, Math.round(b.y1)),
		};
	}

	/** 区域内谓词像素占比 */
	function ratio(f, box, pred) {
		const b = clampBox(box);
		let hit = 0;
		let tot = 0;
		for (let y = b.y0; y <= b.y1; y++) {
			for (let x = b.x0; x <= b.x1; x++) {
				tot++;
				if (pred(f, x, y)) hit++;
			}
		}
		return { hit, total: tot, ratio: tot ? +(hit / tot).toFixed(4) : 0 };
	}

	/** 区域内谓词像素质心 + bbox */
	function centroid(f, box, pred) {
		const b = clampBox(box);
		let sx = 0;
		let sy = 0;
		let n = 0;
		let minX = 1e9;
		let maxX = -1;
		let minY = 1e9;
		let maxY = -1;
		for (let y = b.y0; y <= b.y1; y++) {
			for (let x = b.x0; x <= b.x1; x++) {
				if (pred(f, x, y)) {
					sx += x;
					sy += y;
					n++;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}
		if (!n) return { n: 0, cx: null, cy: null, bbox: null };
		return {
			n,
			cx: +(sx / n).toFixed(1),
			cy: +(sy / n).toFixed(1),
			bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
		};
	}

	/** 相邻帧差分：区域平均绝对亮度差 + 变化像素占比 */
	function diff(fa, fb, box) {
		const b = clampBox(box);
		let sum = 0;
		let changed = 0;
		let tot = 0;
		for (let y = b.y0; y <= b.y1; y++) {
			for (let x = b.x0; x <= b.x1; x++) {
				const d = Math.abs(lum(fa, x, y) - lum(fb, x, y));
				sum += d;
				if (d > 0.06) changed++;
				tot++;
			}
		}
		return {
			meanAbs: +(sum / tot).toFixed(4),
			changedRatio: +(changed / tot).toFixed(4),
			pixels: tot,
		};
	}

	/** 环形带内亮像素拟合圆心（自校准 HUD 洞心，吃掉面板浮动） */
	function fitRing(f, cx0, cy0, r0, r1, thr) {
		let sx = 0;
		let sy = 0;
		let n = 0;
		for (let a = 0; a < 360; a += 1) {
			const rad = (a * Math.PI) / 180;
			const ca = Math.cos(rad);
			const sa = Math.sin(rad);
			for (let r = r0; r <= r1; r++) {
				const x = Math.round(cx0 + ca * r);
				const y = Math.round(cy0 + sa * r);
				if (lum(f, x, y) > thr) {
					sx += x;
					sy += y;
					n++;
				}
			}
		}
		if (n < 40) return { n, cx: null, cy: null };
		return { n, cx: +(sx / n).toFixed(1), cy: +(sy / n).toFixed(1) };
	}

	/** 点位峰值亮度 + 若干旋转角度对照组（用于雷达目标点判定） */
	function peaks(f, cx, cy, points, half, controlAnglesDeg) {
		const angles = controlAnglesDeg && controlAnglesDeg.length ? controlAnglesDeg : [90];
		return points.map((p) => {
			const px = cx + p.dx;
			const py = cy + p.dy;
			let best = 0;
			for (let dy = -half; dy <= half; dy++) {
				for (let dx = -half; dx <= half; dx++) {
					const l = lum(f, px + dx, py + dy);
					if (l > best) best = l;
				}
			}
			const ctrls = angles.map((deg) => {
				const rad = (deg * Math.PI) / 180;
				const qx = Math.round(cx + p.dx * Math.cos(rad) - p.dy * Math.sin(rad));
				const qy = Math.round(cy + p.dx * Math.sin(rad) + p.dy * Math.cos(rad));
				let c = 0;
				for (let dy = -half; dy <= half; dy++) {
					for (let dx = -half; dx <= half; dx++) {
						const l = lum(f, qx + dx, qy + dy);
						if (l > c) c = l;
					}
				}
				return +c.toFixed(3);
			});
			return { ...p, px: Math.round(px), py: Math.round(py), best: +best.toFixed(3), ctrls };
		});
	}

	/** 沿 x 轴的暗色连通簇计数（轮簇 / 车轮轮廓检测用） */
	function columnClusters(f, box, pred, minGap) {
		const b = clampBox(box);
		const cols = [];
		for (let x = b.x0; x <= b.x1; x++) {
			let c = 0;
			for (let y = b.y0; y <= b.y1; y++) if (pred(f, x, y)) c++;
			cols.push(c);
		}
		const minCol = 2;
		const clusters = [];
		let start = -1;
		let gap = 0;
		for (let i = 0; i < cols.length; i++) {
			if (cols[i] >= minCol) {
				if (start < 0) start = i;
				gap = 0;
			} else if (start >= 0) {
				gap++;
				if (gap > minGap) {
					clusters.push({ x0: b.x0 + start, x1: b.x0 + i - gap, w: i - gap - start });
					start = -1;
					gap = 0;
				}
			}
		}
		if (start >= 0) clusters.push({ x0: b.x0 + start, x1: b.x0 + cols.length - 1, w: cols.length - start });
		return clusters.filter((c) => c.w >= 3);
	}

	/** 区域裁剪 → PNG dataURL（归档用） */
	function crop(f, box) {
		const b = clampBox(box);
		const w = b.x1 - b.x0 + 1;
		const h = b.y1 - b.y0 + 1;
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const cx2 = c.getContext('2d');
		const img = cx2.createImageData(w, h);
		for (let y = 0; y < h; y++) {
			const src = ((b.y0 + y) * f.w + b.x0) * 4;
			img.data.set(f.data.subarray(src, src + w * 4), y * w * 4);
		}
		cx2.putImageData(img, 0, 0);
		return { w, h, dataUrl: c.toDataURL('image/png') };
	}

	/** 区域平均色（存证用） */
	function meanColor(f, box) {
		const b = clampBox(box);
		let r = 0;
		let g = 0;
		let bl = 0;
		let n = 0;
		for (let y = b.y0; y <= b.y1; y += 2) {
			for (let x = b.x0; x <= b.x1; x += 2) {
				const [pr, pg, pb] = rgb(f, x, y);
				r += pr;
				g += pg;
				bl += pb;
				n++;
			}
		}
		return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n) };
	}

	/* ---------------- 操作分发 ---------------- */

	const ops = {
		info: () => ({ w: st.frames[0].w, h: st.frames[0].h, canvasW: st.cv.width, canvasH: st.cv.height, dpr: window.devicePixelRatio }),
		bands: (a) =>
			st.frames.map((f) => {
				const out = {};
				for (const b of a.list) out[b.id] = ratio(f, b, makePred(b.pred || 'bright', b.thr ?? 0.5)).ratio;
				return out;
			}),
		centroid: (a) => st.frames.map((f) => centroid(f, a.box, makePred(a.pred, a.thr))),
		ratio: (a) => st.frames.map((f) => ratio(f, a.box, makePred(a.pred, a.thr))),
		diff: (a) => {
			if (a && a.b !== undefined) return [diff(st.frames[a.a ?? st.frames.length - 2], st.frames[a.b], a.box)];
			const out = [];
			for (let i = 1; i < st.frames.length; i++) out.push(diff(st.frames[i - 1], st.frames[i], a.box));
			return out;
		},
		fitRing: (a) => st.frames.map((f) => fitRing(f, a.cx0, a.cy0, a.r0, a.r1, a.thr)),
		peaks: (a) => st.frames.map((f) => peaks(f, a.cx, a.cy, a.points, a.half, a.controlAnglesDeg)),
		clusters: (a) => st.frames.map((f) => columnClusters(f, a.box, makePred(a.pred, a.thr), a.minGap ?? 3)),
		crop: (a) => crop(st.frames[a.frame ?? 0], a.box),
		meanColor: (a) => st.frames.map((f) => meanColor(f, a.box)),
	};

	window.__tcn = {
		cap,
		reset: () => {
			st.frames.length = 0;
		},
		op: async (name, args) => {
			const fn = ops[name];
			if (!fn) throw new Error('unknown op ' + name);
			if (!st.frames.length) throw new Error('no frames captured (call cap first)');
			return fn(args || {});
		},
	};
	return 'installed';
}
