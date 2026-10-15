import test from 'node:test';
import assert from 'node:assert/strict';
import { observeQuality, acceptedQualityTurns } from '../src/director/quality.js';
import { normalizeSettings } from '../src/settings.js';
const prose = 'Она осторожно поставила чашку на стол и посмотрела в окно. За стеклом медленно кружились листья, а в комнате по-прежнему было тихо.';
const turn = (i, text = prose) => ({ ref: 'branch-'+i, text });

test('repeated long passages produce evidence identifiers without leaking text', () => {
 const result = observeQuality([turn(1),turn(2),turn(3)]);
 assert.equal(result.status,'CONFIRMED_SIGNAL');
 assert.equal(result.signals[0].evidence_refs.length,3);
 assert.ok(!JSON.stringify(result).includes('чашку'));
});
test('one match is only a candidate; short responses and silence are not slop', () => {
 assert.equal(observeQuality([turn(1,'A different account of a journey across the mountains, with distant bells and an unexpected message from the harbour.'),turn(2),turn(3)]).status,'CANDIDATE');
 assert.equal(observeQuality([turn(1,'...'),turn(2,'...'),turn(3,'...')]).status,'NONE');
});
test('fresh response and window expiry remove old signals', () => {
 const fresh = 'The mechanic opened the engine cover and found a loose cable beside the starter. After reconnecting it, she checked the voltage and called the pilot.';
 assert.equal(observeQuality([turn(1),turn(2),turn(3),turn(4,fresh)]).status,'NONE');
 assert.equal(observeQuality([turn(1),turn(2),turn(3),turn(4,''),turn(5,''),turn(6,''),turn(7,prose)],4).status,'NONE');
});
test('English and non-Latin text use the same observation algorithm', () => {
 for(const text of ['He turned toward the window and folded his hands across his chest. Outside the rain fell steadily, and the empty street was quiet.', '彼女は窓の外を眺めながら静かに椅子に座っていた。部屋には時計の音だけが響いていて、遠くから風の音が聞こえてきた。'.repeat(3)]) {
  assert.equal(observeQuality([turn(1,text),turn(2,text),turn(3,text)]).status,'CONFIRMED_SIGNAL');
 }
});
test('accepted prefix excludes disputed and abandoned messages', () => {
 const refs=[0,1,2].map(i=>({idempotencyKey:'k'+i,messageIndex:i}));
 const manager={findAccepted:k=>k!=='k1'};
 assert.deepEqual(acceptedQualityTurns([{mes:prose},{mes:'disputed'},{mes:'abandoned'}],refs,manager),[{ref:'k0',text:prose}]);
});
test('unsupported soft mode is disabled and window is bounded', () => {
 assert.equal(normalizeSettings({antiSlopMode:'strict'}).antiSlopMode,'off');
 assert.equal(normalizeSettings({qualityWindow:99}).qualityWindow,12);
 assert.equal(normalizeSettings({qualityWindow:-1}).qualityWindow,4);
});


test('soft note has accepted-turn TTL, cooldown and no refresh on repeated PRE', async () => {
 const {advanceQualityNote}=await import('../src/director/quality.js');
 const signal={status:'CONFIRMED_SIGNAL'};
 let note=advanceQualityNote(null,signal,['a','b','c'],'room');
 assert.equal(note.status,'ACTIVE');
 assert.equal(advanceQualityNote(note,signal,['a','b','c'],'room'),note);
 note=advanceQualityNote(note,signal,['a','b','c','d'],'room');
 assert.equal(note.createdTurn,3);
 note=advanceQualityNote(note,signal,['a','b','c','d','e'],'room');
 assert.equal(note.status,'EXPIRED');
 note=advanceQualityNote(note,signal,['a','b','c','d','e','f'],'room');
 assert.equal(note.status,'ACTIVE');assert.equal(note.createdTurn,6);
});
test('scene changes, branch replacement and improvement remove old soft notes', async () => {
 const {advanceQualityNote,qualityHintCategory}=await import('../src/director/quality.js');
 const note=advanceQualityNote(null,{status:'CONFIRMED_SIGNAL'},['a','b','c'],'room');
 assert.equal(qualityHintCategory(note,'other'),null);
 assert.equal(advanceQualityNote(note,{status:'NONE'},['a','b','c'],'other').status,'EXPIRED');
 assert.equal(advanceQualityNote(note,{status:'NONE'},['a','x'],'room'),null);
 assert.equal(advanceQualityNote(note,{status:'NONE'},['a','b','c','d'],'room').status,'EXPIRED');
});
