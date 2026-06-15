const MODEL = 'gemini-2.5-flash';
const RETRY_DELAYS_MS = [3000, 8000];

async function callGemini(url: string, body: object): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    if (res.status !== 503 || attempt === RETRY_DELAYS_MS.length) return res;
    await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
  throw new Error('Gemini unreachable');
}

export async function processHtml(rawHtml: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Clé Gemini manquante (GEMINI_API_KEY).');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const MAX_BYTES = 600_000;
  const html = rawHtml.length > MAX_BYTES
    ? rawHtml.substring(0, MAX_BYTES) + '\n<!-- [TRONQUÉ] -->'
    : rawHtml;

  const prompt =
    'CONTEXTE : Robot assembleur HTML Emailing.\n' +
    'INPUT : Code HTML généré depuis un Google Doc.\n' +
    'MISSION (une seule) :\n' +
    '1. CORRIGE les listes : Regroupe les <li> consécutifs dans un seul <ul> ou <ol>\n' +
    '   selon la balise ouvrante fournie. Fusionne les listes adjacentes de même type.\n' +
    '2. NE TOUCHE RIEN D\'AUTRE : ni styles, ni tables, ni images, ni <hr>, ni titres.\n' +
    '3. NE COUPE PAS LE TEXTE. Renvoie la totalité du HTML sans markdown.\n\n' +
    'CODE :\n' + html;

  const res = await callGemini(url, { contents: [{ parts: [{ text: prompt }] }] });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Error ${res.status}: ${err.substring(0, 300)}`);
  }

  const json = await res.json();
  if (!json.candidates?.[0]) {
    throw new Error('Gemini Error: ' + JSON.stringify(json).substring(0, 300));
  }

  return (json.candidates[0].content.parts[0].text as string)
    .replace(/```html/g, '')
    .replace(/```/g, '')
    .trim();
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false, message: 'Clé Gemini manquante.' };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Réponds uniquement par le mot: OK' }] }] }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = await res.json();
    if (json.candidates?.[0]) return { ok: true, message: '✅ Gemini opérationnel !' };
    return { ok: false, message: '❌ Réponse inattendue : ' + JSON.stringify(json).substring(0, 200) };
  } catch (e) {
    return { ok: false, message: '❌ ' + (e as Error).message };
  }
}
