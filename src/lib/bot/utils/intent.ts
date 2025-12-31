// src/lib/bot/utils/intent.ts

export async function detectIntent(text: string): Promise<string> {
  const prompt = `
Tu es un assistant de facturation WhatsApp intelligent.
Ta mission est de comprendre l'intention de l'utilisateur à partir de son message.

Voici les intentions possibles avec des exemples :
- create_devis : "Je veux faire un devis", "Nouveau devis pour Martin", "Créer devis", "Devis"
- create_facture : "Je veux faire une facture", "Nouvelle facture", "Facturer le client"
- list_devis : "Mes devis", "Voir mes derniers devis", "Liste des devis", "Historique devis"
- list_factures : "Mes factures", "Voir mes factures", "Historique factures", "Paiements"
- show_menu : "Menu", "Aide", "Que peux-tu faire ?", "Options", "Bonjour", "Salut", "Yo"
- unknown : Tout ce qui ne correspond pas clairement aux intentions ci-dessus.

Règles :
1. Réponds UNIQUEMENT par l'intention en minuscules (ex: "create_devis").
2. Si le message est vague ou incompréhensible, réponds "unknown".
3. Sois flexible : "Je veux un devis" et "Faire un devis" sont la même intention.

Message de l'utilisateur : "${text}"
Intention détectée :`;

  try {
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
        max_tokens: 20,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erreur Groq intent:', errorText);
      return 'unknown';
    }

    const data = await response.json();
    const intent = data.choices[0].message.content.trim().toLowerCase();

    console.log(`[Intent] Texte: "${text}" -> Détecté: "${intent}"`);

    // Nettoyage au cas où l'IA bavarde un peu
    if (intent.includes('create_devis')) return 'create_devis';
    if (intent.includes('create_facture')) return 'create_facture';
    if (intent.includes('list_devis')) return 'list_devis';
    if (intent.includes('list_factures')) return 'list_factures';
    if (intent.includes('show_menu')) return 'show_menu';

    return 'unknown';
  } catch (error) {
    console.error('Erreur technique detectIntent:', error);
    return 'unknown';
  }
}