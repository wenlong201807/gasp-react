/** TC-09 静态检查：pnpm lint && pnpm build 零 error（套件顺带把关） */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO_ROOT } from '../lib/config.mjs';

const exec = promisify(execFile);

/** @param {import('../lib/context.mjs').TestContext} ctx */
export async function run(ctx) {
	const evidence = [];
	const detail = {};
	const checks = {};
	for (const [key, cmd, args] of [
		['lint', 'pnpm', ['lint']],
		['build', 'pnpm', ['build']],
	]) {
		const t0 = Date.now();
		try {
			const { stdout, stderr } = await exec(cmd, args, { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 });
			const output = `${stdout}\n${stderr}`;
			detail[key] = { ok: true, code: 0, durMs: Date.now() - t0, errorLines: matchErrorLines(output), tail: output.slice(-3500) };
			checks[key] = detail[key].errorLines.length === 0;
		} catch (e) {
			const output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
			detail[key] = { ok: false, code: e.code ?? 1, durMs: Date.now() - t0, errorLines: matchErrorLines(output), tail: output.slice(-3500) };
			checks[key] = false;
		}
		evidence.push(`${cmd} ${args.join(' ')} → ${detail[key].ok ? 'exit 0' : 'exit ' + detail[key].code}（${Math.round(detail[key].durMs / 1000)}s）error 行 ${detail[key].errorLines.length}`);
	}
	detail.checks = checks;
	evidence.push(ctx.saveEvidence('evidence', detail));

	const notes = [];
	if (!checks.lint) notes.push(`pnpm lint：${detail.lint.errorLines[0] ?? 'exit ' + detail.lint.code}`);
	if (!checks.build) notes.push(`pnpm build：${detail.build.errorLines[0] ?? 'exit ' + detail.build.code}`);
	return {
		pass: checks.lint && checks.build,
		note: notes.join('；') || `pnpm lint ✓（${Math.round(detail.lint.durMs / 1000)}s）· pnpm build ✓（${Math.round(detail.build.durMs / 1000)}s）零 error`,
		checks,
		evidence,
	};
}

function matchErrorLines(output) {
	return output
		.split('\n')
		.filter((l) => /\berror\b/i.test(l))
		.slice(0, 5);
}

