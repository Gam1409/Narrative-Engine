// Language-independent lexical fallback: Unicode words plus character n-grams.
// This handles spelling/inflection overlap; it is not translation or semantic understanding.
export function lexicalTokens(text) {
    const words = String(text || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
    const tokens = new Set(words);
    for (const word of words) {
        const letters = Array.from(word);
        const size = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word) ? 2 : 3;
        for (let index = 0; index <= letters.length - size; index++) tokens.add(letters.slice(index, index + size).join(''));
    }
    return tokens;
}
export async function textHash(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
}
export function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return 0; dot += a[i]*b[i]; aa += a[i]*a[i]; bb += b[i]*b[i]; }
    return aa && bb ? dot / Math.sqrt(aa*bb) : 0;
}
