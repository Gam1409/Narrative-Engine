import {createStudyDeadline} from './study-deadline.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {EVENT_SYSTEM, EMOTION_SYSTEM, parseJson, reduceEvents, validateEmotions} from './event-memory-study.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
for (const name of ['--baseline', '--output', '--endpoint']) {
    if (!args.includes(name) || !option(name) || option(name).startsWith('--')) throw Error('Missing ' + name);
}
const endpoint = new URL(option('--endpoint'));
if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password
    || endpoint.search || endpoint.hash) throw Error('Invalid endpoint');
const base = option('--baseline'), output = option('--output');
const read = async name => JSON.parse(await fs.readFile(path.join(base, name), 'utf8'));
const [requests, key, previous] = await Promise.all([read('requests.json'), read('key.json'), read('results.json')]);
const jobs = requests.filter(job => key.find(entry => entry.id === job.id)?.arm === 'plain_reference');
if (jobs.length !== 12) throw Error('Expected twelve baseline cases');
for (let i = jobs.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
}
await fs.mkdir(output, {recursive: false});
const write = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const report = {kind: 'two-stage-event-memory-experiment', baseline: base, results: [],
    limits: 'Exploratory reuse of known cases; historical baseline; not an independent holdout or production acceptance.',
    config: previous.config, totalBudgetMs: 40000, targetMs: 30000};
let failures = 0;
async function call(system, payload, template, deadline) {
    const request = {...template, messages: [{role: 'system', content: system},
        {role: 'user', content: JSON.stringify(payload)}]};
    const stage = {request}, start = performance.now();
    try {
        const remaining = deadline.remaining();
        const response = await fetch(endpoint.href.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST', headers: {'content-type': 'application/json',
                ...(process.env.NE_STUDY_API_KEY ? {authorization: 'Bearer ' + process.env.NE_STUDY_API_KEY} : {})},
            body: JSON.stringify(request), signal: AbortSignal.timeout(remaining),
        });
        if (!response.ok) throw Error('HTTP ' + response.status);
        const body = await response.json();
        stage.raw = body.choices?.[0]?.message?.content;
        stage.finishReason = body.choices?.[0]?.finish_reason;
        stage.usage = body.usage;
        if (stage.finishReason === 'length') throw Error('Truncated output');
        stage.parsed = parseJson(stage.raw);
        deadline.remaining();
    } catch (error) {
        delete stage.parsed;
        stage.error = String(error.message).slice(0, 200);
        stage.timedOut = error.name === 'TimeoutError';
    }
    stage.ms = Math.round(performance.now() - start);
    return stage;
}
await write('results.json', report);
for (const job of jobs) {
    const result = {id: crypto.randomBytes(12).toString('hex'), caseId: job.caseId, baselineId: job.id};
    const payload = JSON.parse(job.request.messages[1].content);
    const caseStarted = performance.now(), deadline = createStudyDeadline(report.totalBudgetMs);
    result.events = await call(EVENT_SYSTEM, payload, job.request, deadline);
    try {
        if (result.events.error) throw Error(result.events.error);
        result.state = reduceEvents(result.events.parsed, payload.evidence_catalog);
        result.emotions = await call(EMOTION_SYSTEM, {...payload, cast: result.state.cast,
            physical_state: result.state.characters}, job.request, deadline);
        if (result.emotions.error) throw Error(result.emotions.error);
        result.psychology = validateEmotions(result.emotions.parsed, result.state.cast, payload.evidence_catalog);
        result.valid = true;
    } catch (error) {
        result.valid = false;
        result.error = String(error.message).slice(0, 200);
    }
    result.ms = Math.round(performance.now() - caseStarted);
    report.results.push(result);
    failures = result.valid ? 0 : failures + 1;
    if (result.events.timedOut || result.emotions?.timedOut) {
        report.stoppedEarly = 'Deadline reached; provider may still process the aborted request. Stop before queuing more work.';
    }
    if (failures >= 2) report.stoppedEarly = 'Two consecutive invalid cases; inspect before more calls.';
    await write('results.json', report);
    console.log(JSON.stringify({completed: report.results.length, total: jobs.length, caseId: result.caseId,
        valid: result.valid, ms: result.ms, error: result.error}));
    if (report.stoppedEarly) break;
}
if (report.results.some(result => !result.valid)) process.exitCode = 1;
