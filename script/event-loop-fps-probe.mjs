const assert = (condition, message) => {
	if (!condition) throw new Error(message);
	console.log(`✅ ${message}`);
};

function sampleFps(times, now) {
	const recent = times.filter((time) => time >= now - 1000);
	if (recent.length < 2 || now - recent.at(-1) > 500) return null;
	const elapsed = recent.at(-1) - recent[0];
	return elapsed > 0 ? Math.max(0, Math.round(((recent.length - 1) * 1000) / elapsed)) : null;
}

const steady = Array.from({ length: 61 }, (_, i) => i * (1000 / 60));
const steadyFps = sampleFps(steady, 1000);
assert(steadyFps >= 59 && steadyFps <= 61, `steady stream is ${steadyFps} FPS`);
assert(sampleFps([0], 0) === null, 'single frame is unavailable');
assert(sampleFps([0, 16, 32], 600) === null, 'stale stream is unavailable');
assert(sampleFps([0, 400, 800, 1200], 1200) === 3, 'one-second window drops old frames');
