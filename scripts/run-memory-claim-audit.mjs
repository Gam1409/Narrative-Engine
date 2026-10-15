import {createStudyDeadline} from './study-deadline.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {AUDIT_SYSTEM, collectClaims, validateAudit} from './memory-claim-audit.mjs';
import {parseJson} from './event-memory-study.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
for (const name of ['--input', '--output', '--endpoint']) {
    if (!args.includes(name) || !option(name) || option(name).startsWith('--')) throw Error('Missing ' + name);
}
const endpoint = new URL(option('--endpoint'));
if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash) throw Error('Invalid endpoint');
const source = JSON.parse(await fs.readFile(path.join(option('--input'), 'results.json'), 'utf8'));
if (source.results.length !== 12 || source.stoppedEarly) throw Error('Finish the source run first');
const output = option('--output');
await fs.mkdir(output, {recursive: false});
const report = {kind: 'bounded-semantic-audit', source: option('--input'), totalBudgetMs: 40000,
    minAuditBudgetMs: 12000, targetMs: 30000, results: [],
    limitations: 'Audit replay after the two-stage run, not a measured end-to-end scheduler. Sum of measured calls only. No retries.'};
const save = () => fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
// Largest remaining budget first. Skipped cases remain explicitly unverified.
const jobs = [...source.results].sort((a, b) => a.ms - b.ms);
for (const job of jobs) {
    const remaining = report.totalBudgetMs - job.ms;
    const row = {caseId: job.caseId, previousMs: job.ms, remainingMs: remaining};
    report.results.push(row);
    if (!job.valid || remaining < report.minAuditBudgetMs) {
        row.skipped = !job.valid ? 'Invalid previous stage' : 'Insufficient remaining budget';
        await save();
        continue;
    }
    const claims = collectClaims(job);
    const payload = JSON.parse(job.events.request.messages[1].content);
    const request = {...job.events.request, messages: [{role: 'system', content: AUDIT_SYSTEM},
        {role: 'user', content: JSON.stringify({...payload, claims})}]};
    row.claims = claims;
    row.request = request;
    const start = performance.now(), deadline = createStudyDeadline(remaining);
    try {
        const response = await fetch(endpoint.href.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST', headers: {'content-type': 'application/json',
                ...(process.env.NE_STUDY_API_KEY ? {authorization: 'Bearer ' + process.env.NE_STUDY_API_KEY} : {})},
            body: JSON.stringify(request), signal: AbortSignal.timeout(deadline.remaining()),
        });
        if (!response.ok) throw Error('HTTP ' + response.status);
        const body = await response.json();
        row.raw = body.choices?.[0]?.message?.content;
        row.usage = body.usage;
        if (body.choices?.[0]?.finish_reason === 'length') throw Error('Truncated audit');
        row.audit = validateAudit(parseJson(row.raw), claims, payload.evidence_catalog);
        deadline.remaining();
        row.valid = true;
    } catch (error) {
        row.valid = false;
        delete row.audit;
        row.error = String(error.message).slice(0, 200);
        if (error.name === 'TimeoutError') report.stoppedEarly = 'Shared time budget exhausted; provider may still be processing the aborted request.';
    }
    row.ms = Math.round(performance.now() - start);
    row.totalMs = job.ms + row.ms;
    if (row.totalMs > report.totalBudgetMs) {
        row.valid = false;
        delete row.audit;
        row.error = 'Result arrived outside shared time budget';
    }
    await save();
    console.log(JSON.stringify({caseId: row.caseId, valid: row.valid, totalMs: row.totalMs, error: row.error}));
    if (report.stoppedEarly) break;
}
await save();
