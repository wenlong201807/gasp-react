#!/usr/bin/env node
// 「URL 生命周期」两幕剧本结构校验（方案 docs/url-lifecycle-anim-design.md §10.1 共 9 条断言）：
// 校验 stages/firstLoad.ts（幕一 20 步）与 stages/refresh.ts（幕二 14 步）的
// 步数与 id、NodeId/Packet 端点、包两端激活、renderProgress、缓存判定、关键词、文案长度与可序列化。
// 长度断言按显示宽度（全角 1 / 半角 0.5）计，对应方案 §4.3 排版语义。
// 用法：node script/url-lifecycle-verify.mjs
import { FIRST_LOAD } from '../src/components/url-lifecycle/stages/firstLoad.ts';
import { REFRESH } from '../src/components/url-lifecycle/stages/refresh.ts';

// §3 合法字面量集合（types.ts 里是纯类型，.mjs 无法 typeof 引用，故在此镜像为运行时常量）
const NODE_IDS = ['browser', 'dnsCache', 'osCache', 'ldns', 'rootDns', 'cdnEdge', 'nginx'];
const PACKET_KINDS = [
	'request',
	'response',
	'dnsQuery',
	'dnsAnswer',
	'tcpSyn',
	'tcpSynAck',
	'tcpAck',
	'tlsHandshake',
];
const CACHE_VERDICTS = ['miss', 'strongHit', 'revalidate', 'notModified304', 'fresh200'];

// 断言 8 前置：按显示宽度计数（全角 1 / 半角 0.5），对应方案 §4.3「11px 字号下 24 字内单行」的排版宽度语义。
// Array.from 按 Unicode 码点迭代（而非 UTF-16 码元）；东亚宽字符（CJK、全角标点等）计 1，其余含 ASCII 计 0.5。
const WIDE_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;
const displayWidth = (s) => Array.from(s).reduce((w, ch) => w + (WIDE_RE.test(ch) ? 1 : 0.5), 0);

// 类型不符时收口为空数组：让违例以错误信息上报，而不是让校验脚本自己抛异常
const asArray = (v) => (Array.isArray(v) ? v : []);
const asStages = (scenario) => asArray(scenario?.stages);

const fmt = (v) => (v === undefined ? '（缺省）' : JSON.stringify(v));

// —— types.ts 契约 typeof 校验：字段存在性与 typeof 全部对齐 §3 的 Stage / Scenario / Packet ——

// Scenario 外层字段（id/title/subtitle/stages）
function checkScenarioContract(name, scenario) {
	const errors = [];
	if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
		return [`${name} 不是 Scenario 对象`];
	}
	for (const key of ['id', 'title', 'subtitle']) {
		if (typeof scenario[key] !== 'string' || scenario[key].length === 0) {
			errors.push(`Scenario.${key} 应为非空 string，实际 ${fmt(scenario[key])}`);
		}
	}
	if (scenario.id !== undefined && !['first-load', 'refresh'].includes(scenario.id)) {
		errors.push(`Scenario.id 应为 'first-load' | 'refresh'，实际 ${fmt(scenario.id)}`);
	}
	if (!Array.isArray(scenario.stages)) {
		errors.push(`Scenario.stages 应为数组，实际 ${fmt(scenario.stages)}`);
	}
	return errors;
}

// 每一步 Stage / Packet 的字段类型（typeof 校验）
function checkStageContract(name, stages) {
	const errors = [];
	stages.forEach((st, i) => {
		const at = `${name} 第 ${i + 1} 步(${fmt(st.id)})`;
		if (!st || typeof st !== 'object' || Array.isArray(st)) {
			errors.push(`${at} 不是 Stage 对象`);
			return;
		}
		for (const key of ['id', 'title', 'detail']) {
			if (typeof st[key] !== 'string') errors.push(`${at} Stage.${key} 应为 string，实际 ${fmt(st[key])}`);
		}
		if (!Array.isArray(st.activeNodes)) errors.push(`${at} Stage.activeNodes 应为数组，实际 ${fmt(st.activeNodes)}`);
		if (!Array.isArray(st.packets)) errors.push(`${at} Stage.packets 应为数组，实际 ${fmt(st.packets)}`);
		if (st.cacheVerdict !== undefined && !CACHE_VERDICTS.includes(st.cacheVerdict)) {
			errors.push(`${at} cacheVerdict 应为 ${CACHE_VERDICTS.join('/')} 之一，实际 ${fmt(st.cacheVerdict)}`);
		}
		if (st.renderProgress !== undefined && (!Number.isInteger(st.renderProgress) || st.renderProgress < 0 || st.renderProgress > 6)) {
			errors.push(`${at} renderProgress 应为 0..6 整数，实际 ${fmt(st.renderProgress)}`);
		}
		asArray(st.packets).forEach((pk, j) => {
			const pat = `${at} 第 ${j + 1} 个包(${fmt(pk?.id)})`;
			for (const key of ['id', 'from', 'to', 'kind', 'label']) {
				if (!pk || typeof pk[key] !== 'string') errors.push(`${pat} Packet.${key} 应为 string，实际 ${fmt(pk?.[key])}`);
			}
			if (pk && !PACKET_KINDS.includes(pk.kind)) errors.push(`${pat} Packet.kind 非法：${fmt(pk.kind)}`);
		});
	});
	return errors;
}

// —— 方案 §10.1 断言 1~9 ——

// 断言 1：幕一恰 20 步、幕二恰 14 步；Stage.id 唯一且形如 f01..f20 / r01..r14
function checkStageCountAndIds(name, scenario, prefix, expectedCount) {
	const errors = [];
	const stages = asStages(scenario);
	if (stages.length !== expectedCount) {
		errors.push(`${name} 步数应为 ${expectedCount}，实际 ${stages.length}`);
		return errors;
	}
	const expected = new Set(
		Array.from({ length: expectedCount }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`)
	);
	const seen = new Set();
	const pattern = new RegExp(`^${prefix}\\d{2}$`);
	stages.forEach((st, i) => {
		const id = st?.id;
		if (seen.has(id)) errors.push(`${name} Stage.id 重复：${fmt(id)}`);
		seen.add(id);
		if (typeof id !== 'string' || !pattern.test(id)) {
			errors.push(`${name} 第 ${i + 1} 步 id 应形如 ${prefix}01..${prefix}${String(expectedCount).padStart(2, '0')}，实际 ${fmt(id)}`);
		} else if (!expected.has(id)) {
			errors.push(`${name} id ${id} 超出 ${prefix}01..${prefix}${String(expectedCount).padStart(2, '0')} 范围`);
		}
	});
	for (const missing of [...expected].filter((id) => !seen.has(id))) {
		errors.push(`${name} 缺少 id：${missing}`);
	}
	return errors;
}

// 断言 2：activeNodes / Packet.from / Packet.to ∈ NodeId 集合，且 Packet.from !== to
function checkNodeIdsAndPacketEnds(name, stages) {
	const errors = [];
	stages.forEach((st, i) => {
		const at = `${name} 第 ${i + 1} 步(${st.id})`;
		for (const node of asArray(st.activeNodes)) {
			if (!NODE_IDS.includes(node)) errors.push(`${at} activeNodes 含非法 NodeId：${fmt(node)}`);
		}
		for (const pk of asArray(st.packets)) {
			if (!NODE_IDS.includes(pk.from)) errors.push(`${at} 包 ${fmt(pk.id)} from 非法 NodeId：${fmt(pk.from)}`);
			if (!NODE_IDS.includes(pk.to)) errors.push(`${at} 包 ${fmt(pk.id)} to 非法 NodeId：${fmt(pk.to)}`);
			if (pk.from === pk.to) errors.push(`${at} 包 ${fmt(pk.id)} from 与 to 相同：${fmt(pk.from)}`);
		}
	});
	return errors;
}

// 断言 3：每个包的 from 与 to 都出现在同一步 activeNodes（画面上包两端必须亮）
function checkPacketEndpointsActive(name, stages) {
	const errors = [];
	stages.forEach((st, i) => {
		const active = new Set(asArray(st.activeNodes));
		for (const pk of asArray(st.packets)) {
			for (const end of ['from', 'to']) {
				if (!active.has(pk[end])) {
					errors.push(`${name} 第 ${i + 1} 步(${st.id}) 包 ${fmt(pk.id)} 的 ${end}=${fmt(pk[end])} 不在 activeNodes 中`);
				}
			}
		}
	});
	return errors;
}

// 断言 4：renderProgress ∈ 0..6 且逐剧本单调不减；两幕末步均为 6
function checkRenderProgress(name, stages) {
	const errors = [];
	let prev = 0;
	stages.forEach((st, i) => {
		const rp = st.renderProgress;
		if (rp === undefined) return; // §3 允许缺省表示未点亮
		if (!Number.isInteger(rp) || rp < 0 || rp > 6) {
			errors.push(`${name} 第 ${i + 1} 步(${st.id}) renderProgress 应为 0..6 整数，实际 ${fmt(rp)}`);
			return;
		}
		if (rp < prev) errors.push(`${name} 第 ${i + 1} 步(${st.id}) renderProgress ${rp} 小于上一步 ${prev}，不满足单调不减`);
		prev = rp;
	});
	const last = stages[stages.length - 1];
	if (last?.renderProgress !== 6) {
		errors.push(`${name} 末步(${fmt(last?.id)}) renderProgress 应为 6，实际 ${fmt(last?.renderProgress)}`);
	}
	return errors;
}

// 断言 5：幕二必含 cacheVerdict 'notModified304' 与 'strongHit' 各至少一步
function checkRefreshCacheVerdicts(stages) {
	const errors = [];
	const count = (verdict) => asArray(stages).filter((st) => st.cacheVerdict === verdict).length;
	for (const verdict of ['notModified304', 'strongHit']) {
		if (count(verdict) === 0) errors.push(`幕二缺少 cacheVerdict '${verdict}'，两枚举值各至少需 1 步`);
	}
	return errors;
}

// 断言 6：幕二全部 stages 的 title+detail 拼串包含必备关键词
function checkRefreshKeywords(stages) {
	const errors = [];
	const text = asArray(stages).map((st) => `${st.title ?? ''}${st.detail ?? ''}`).join('\n');
	for (const keyword of ['max-age=0', '304', 'disk cache', 'no-cache', '会话复用']) {
		if (!text.includes(keyword)) errors.push(`幕二 title+detail 文案缺少关键词：'${keyword}'`);
	}
	return errors;
}

// 断言 7：幕一必含 tcpSyn / tcpSynAck / tcpAck 三种 PacketKind 各至少一次（三次握手完整）
function checkTcpHandshake(stages) {
	const errors = [];
	const kinds = new Set(stages.flatMap((st) => asArray(st.packets).map((pk) => pk.kind)));
	for (const kind of ['tcpSyn', 'tcpSynAck', 'tcpAck']) {
		if (!kinds.has(kind)) errors.push(`幕一缺少 PacketKind '${kind}'，三次握手不完整`);
	}
	return errors;
}

// 断言 8：title 非空 ≤16、detail 非空 ≤90、Packet.label ≤24（均按显示宽度：全角 1 / 半角 0.5）
function checkTextLengths(name, stages) {
	const errors = [];
	const limit = (field, max) => (value, where) => {
		if (typeof value !== 'string') return; // 类型问题已由 typeof 校验上报
		const n = displayWidth(value);
		if (n === 0) errors.push(`${where} ${field} 为空字符串`);
		if (n > max) errors.push(`${where} ${field} 超长：显示宽度 ${n} > ${max} 上限`);
	};
	const title = limit('title', 16);
	const detail = limit('detail', 90);
	const label = limit('label', 24);
	stages.forEach((st, i) => {
		const at = `${name} 第 ${i + 1} 步(${st.id})`;
		title(st.title, at);
		detail(st.detail, at);
		for (const pk of asArray(st.packets)) label(pk.label, `${at} 包 ${fmt(pk.id)}`);
	});
	return errors;
}

// 断言 9：Scenario 无循环引用、可 JSON.stringify（纯数据校验）
function checkSerializable(name, scenario) {
	const errors = [];
	let json;
	try {
		json = JSON.stringify(scenario);
	} catch (err) {
		return [`${name} JSON.stringify 失败（疑似循环引用或非可序列化值）：${err.message}`];
	}
	if (typeof json !== 'string' || json.length === 0) errors.push(`${name} JSON.stringify 结果为空`);
	if (!json.includes('"stages"')) errors.push(`${name} 序列化结果缺少 stages 字段`);
	return errors;
}

// 逐条汇总执行；任一断言失败打印 ❌ 并置非零退出码
async function main() {
	const scenarios = [
		{ name: '幕一 首次加载', scenario: FIRST_LOAD, prefix: 'f', count: 20 },
		{ name: '幕二 F5 刷新', scenario: REFRESH, prefix: 'r', count: 14 },
	];

	// types.ts 契约 typeof 校验（类型本体在 .mjs 中不可引用，退化为对 §3 运行时常量的存在性检查）
	try {
		const types = await import('../src/components/url-lifecycle/types.ts');
		const contract = [
			['STAGE', types.STAGE],
			['STEP_SECONDS', types.STEP_SECONDS],
			['ZONE_COLOR', types.ZONE_COLOR],
		];
		const missing = contract.filter(([, v]) => v === undefined).map(([k]) => k);
		if (missing.length > 0) {
			console.error(`❌ types.ts 契约: 缺少 §3 常量导出 ${missing.join(' / ')}`);
			process.exitCode = 1;
		} else if (types.STAGE?.w !== 1200 || types.STAGE?.h !== 800 || types.STEP_SECONDS !== 1.6) {
			console.error(`❌ types.ts 契约: STAGE/STEP_SECONDS 与 §3 不符（STAGE=${JSON.stringify(types.STAGE)}, STEP_SECONDS=${types.STEP_SECONDS}）`);
			process.exitCode = 1;
		} else {
			console.log(`✅ types.ts 契约: STAGE ${types.STAGE.w}x${types.STAGE.h}, STEP_SECONDS ${types.STEP_SECONDS}s`);
		}
	} catch {
		console.warn('⚠️  未找到 src/components/url-lifecycle/types.ts（尚未落码，跳过契约常量检查）');
	}

	for (const { name, scenario, prefix, count } of scenarios) {
		const stages = asStages(scenario);
		const checks = [
			checkScenarioContract(name, scenario),
			checkStageContract(name, stages),
			checkStageCountAndIds(name, scenario, prefix, count),
			checkNodeIdsAndPacketEnds(name, stages),
			checkPacketEndpointsActive(name, stages),
			checkRenderProgress(name, stages),
			...(prefix === 'r' ? [checkRefreshCacheVerdicts(stages), checkRefreshKeywords(stages)] : []),
			...(prefix === 'f' ? [checkTcpHandshake(stages)] : []),
			checkTextLengths(name, stages),
			checkSerializable(name, scenario),
		];
		const errors = checks.flat();

		if (errors.length > 0) {
			process.exitCode = 1;
			console.error(`❌ ${name}（${stages.length} 步）: ${errors.length} 处不符`);
			for (const e of errors) console.error(`   - ${e}`);
		} else {
			const packets = stages.reduce((n, st) => n + asArray(st.packets).length, 0);
			console.log(`✅ ${name}: ${stages.length} 步 / ${packets} 个包，§10.1 断言全部通过`);
		}
	}

	if (process.exitCode === 1) {
		console.error('❌ URL 生命周期剧本校验未通过');
	} else {
		console.log('✅ URL 生命周期剧本校验全部通过（幕一 20 步 + 幕二 14 步，9 条断言）');
	}
}

await main();
