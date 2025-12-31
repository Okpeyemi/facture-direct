// src/lib/bot/utils/intent.ts

export async function detectIntent(text: string): Promise<string> {
  const prompt = `
Tu es un assistant de facturation WhatsApp.
Analyse le message suivant et réponds UNIQUEMENT par l'intention principale en minuscules, sans explication.

Intentions possibles :
- create_devis
- create_facture
- list_devis
- list_factures
- show_menu
- unknown

Message : "${text}"
Intention :`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 10,
    }),
  });

  if (!response.ok) {
    console.error('Erreur Groq intent:', await response.text());
    return 'unknown';
  }

  const data = await response.json();
  return data.choices[0].message.content.trim().toLowerCase();
}