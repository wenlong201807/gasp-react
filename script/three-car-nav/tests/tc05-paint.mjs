/**
 * TC-05 漆面存证（视觉判定项）：四区域裁剪截图归档 + 平均色记录。
 * 通过标准 = 四张裁剪全部生成成功（尺寸正确、非空）且平均色已记录。
 */
import { PAINT_CROPS } from '../lib/config.mjs';

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	const detail = { crops: [] };
	await ctx.newPage();
	await ctx.openThroughMenu();
	const { status } = await ctx.waitModelStatus();
	if (status !== 'ready') {
		await ctx.close();
		return { pass: false, note: `modelStatus=${status}，SU7 未就绪，漆面存证无意义`, checks: {}, evidence };
	}
	await ctx.page.waitForTimeout(1500);
	await ctx.snapOnly(1, 0);

	for (const crop of PAINT_CROPS) {
		const mean = (await ctx.px('meanColor', { box: crop }))[0];
		const saved = await ctx.saveCrop(`paint-${crop.id}`, crop);
		const ok = saved.w === crop.x1 - crop.x0 + 1 && saved.h === crop.y1 - crop.y0 + 1;
		detail.crops.push({ id: crop.id, label: crop.label, file: saved.file, w: saved.w, h: saved.h, meanColor: mean, sizedOk: ok });
		evidence.push(saved.file);
	}
	detail.modelStatus = status;
	detail.state = await ctx.getState();
	evidence.push(await ctx.shot('paint-full'));
	evidence.push(ctx.saveEvidence('evidence', detail));
	await ctx.close();

	const ok = detail.crops.length === PAINT_CROPS.length && detail.crops.every((c) => c.sizedOk);
	return {
		pass: ok,
		note: ok ? '四区域裁剪已归档（车头/门板/车顶/前轮拱），平均色已记录' : '裁剪生成失败或尺寸不符',
		checks: { allGenerated: ok },
		evidence,
	};
}
