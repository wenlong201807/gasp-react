/** 判定表输出 + 退出码汇总 */

const ROW = '─'.repeat(96);

export function printHeader(title) {
	console.log(`\n${ROW}\n== ${title}\n${ROW}`);
}

export function printResults(rows) {
	console.log(`\n${'═'.repeat(96)}`);
	console.log('three-car-nav Playwright 套件 · 判定表');
	console.log('═'.repeat(96));
	console.log(`${'TC'.padEnd(7)}${'用例'.padEnd(22)}${'结果'.padEnd(6)}耗时      说明`);
	console.log(ROW);
	for (const r of rows) {
		const mark = r.pass ? '✅' : '❌';
		const note = (r.note || '').replace(/\s+/g, ' ').slice(0, 52);
		console.log(`${r.id.padEnd(7)}${r.name.padEnd(22)}${mark.padEnd(4)}   ${String(r.durS + 's').padEnd(8)} ${note}`);
	}
	console.log(ROW);
	const passed = rows.filter((r) => r.pass).length;
	console.log(`通过 ${passed}/${rows.length}  →  exit ${passed === rows.length ? 0 : 1}`);
	console.log('═'.repeat(96));
	return passed === rows.length;
}

export function printEvidence(rows) {
	console.log('\n证据文件（artifacts/three-car-nav/）:');
	for (const r of rows) {
		if (!r.evidence || !r.evidence.length) continue;
		console.log(`  ${r.id}:`);
		for (const e of r.evidence) console.log(`    - ${e}`);
	}
}
