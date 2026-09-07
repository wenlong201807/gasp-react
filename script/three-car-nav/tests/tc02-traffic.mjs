/** TC-02 车流：trafficTargets 间隔 ≥1s 两采样非空且不同 */

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	await ctx.newPage();
	await ctx.openThroughMenu();
	const { status } = await ctx.waitModelStatus();
	await ctx.page.waitForTimeout(1200);

	const s1 = await ctx.getState();
	await ctx.page.waitForTimeout(1500); // ≥1s
	const s2 = await ctx.getState();

	// 雷达量程（HudSystem：x±25m / z±60m）内才会上报
	const inRange = (t) =>
		Number.isFinite(t.relX) && Number.isFinite(t.relZ) && Math.abs(t.relX) <= 25.001 && Math.abs(t.relZ) <= 60.001;
	const nonEmpty = s1.trafficTargets.length > 0 && s2.trafficTargets.length > 0;
	const changed = JSON.stringify(s1.trafficTargets) !== JSON.stringify(s2.trafficTargets);
	const allInRange = [...s1.trafficTargets, ...s2.trafficTargets].every(inRange);

	evidence.push(await ctx.shot('traffic'));
	evidence.push(ctx.saveEvidence('evidence', { status, s1, s2, nonEmpty, changed, allInRange, nonNetwork: ctx.console.nonNetworkErrors() }));
	await ctx.close();

	const notes = [];
	if (!nonEmpty) notes.push('trafficTargets 存在空采样');
	if (!changed) notes.push('两次采样完全相同（车流未滚动）');
	if (!allInRange) notes.push('存在超出雷达量程 x±25/z±60 的目标');
	return {
		pass: nonEmpty && changed && allInRange,
		note: notes.join('；') || `n1=${s1.trafficTargets.length} n2=${s2.trafficTargets.length} 间隔1.5s 已变化`,
		checks: { nonEmpty, changed, allInRange },
		evidence,
	};
}
