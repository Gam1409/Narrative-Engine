// Text-only A/B: URL MODEL OUTPUT_JSON [PROVIDER_OPTIONS_JSON] [CASES_JSON]. No image requests.
import fs from 'node:fs';
import { intentRequest, parseIntent, VISUAL_PURPOSE } from '../../src/visual/intent.js';
const [url, model, output, optionsFile, casesFile] = process.argv.slice(2);
const options = optionsFile ? JSON.parse(fs.readFileSync(optionsFile, 'utf8')) : {};
const cases = casesFile ? JSON.parse(fs.readFileSync(casesFile, 'utf8')) : [
    { id: 'anger', expression: 'brows lowered, eyes narrowed, lips pressed in anger', expected: { eyes: 'narrowed eyes', brows: 'lowered eyebrows', mouth: 'pressed lips' } },
    { id: 'wink', expression: 'one eye closed, broad smile', expected: { eyes: 'one eye closed', mouth: 'broad smile' } },
    { id: 'absent', expression: '', expected: { eyes: 'preserve', brows: 'preserve', mouth: 'preserve', cheeks: 'preserve' } },
    { id: 'subtle', expression: 'a small smile, relaxed eyes, relaxed eyebrows', expected: { eyes: 'relaxed eyes', brows: 'relaxed eyebrows', mouth: 'small smile' } },
];
const results = [];
for (const [index, item] of cases.entries()) {
    // Alternate order to reduce simple warm-up/order bias; one sample per condition is exploratory.
    for (const purpose of index % 2 ? [true, false] : [false, true]) {
        const characters = item.characters || [{expression:item.expression, expected:item.expected}];
        const scene = { location: { id: 'room' }, characters: characters.map((c,i) => ({id: i ? 'adult_kenzie' : 'adult_wren', pose:'standing', emotion:c.expression, expressed:[]})) };
        const profile = item.profile || 'illustrious';
        const request = intentRequest(scene, profile);
        if (!purpose) request.messages[0].content = request.messages[0].content.replace(VISUAL_PURPOSE, '');
        const started = Date.now();
        const row = { case: item.id, scene, expected: characters.map(c=>c.expected), purpose, model, profile, providerOptions: options };
        try {
            const response = await fetch(url.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...options, model, messages: request.messages, max_tokens: request.maxTokens, temperature: 0.2, stream: false }), signal: AbortSignal.timeout(45000) });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const body = await response.json();
            row.raw = body.choices?.[0]?.message?.content;
            row.intent = parseIntent(row.raw, scene);
            row.valid = true;
            row.mismatches = characters.flatMap((c,i) => Object.entries(c.expected).filter(([key,value]) => row.intent.characters[i][key] !== value).map(([key,value]) => ({id:scene.characters[i].id,feature:key,expected:value,actual:row.intent.characters[i][key]})));
            row.expectedFeaturesMatch = row.mismatches.length === 0;
        } catch (error) { row.valid = false; row.error = error.message; }
        row.ms = Date.now() - started;
        results.push(row); fs.writeFileSync(output, JSON.stringify(results, null, 2)); console.log(JSON.stringify({case:row.case,purpose,valid:row.valid,match:row.expectedFeaturesMatch,ms:row.ms,error:row.error,mismatches:row.mismatches}));
    }
}
