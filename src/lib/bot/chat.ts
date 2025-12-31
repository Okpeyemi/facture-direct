import { sendWhatsAppText } from '@/lib/whatsapp-utils';

export async function handleChat(from: string, user: any, text: string) {
    try {
        const prompt = `
      Tu es l'assistant IA de FactureDirect.
      Tu parles à ${user.prenom || user.nom} (Role: ${user.role}) de l'entreprise "${user.entreprise.nom}".
      
      TES CAPACITÉS (Ce que tu peux faire réellement) :
      1. Créer un devis (Commande: "Je veux créer un devis")
      2. Lister les devis (Commande: "Mes devis")
      3. Lister les factures (Commande: "Mes factures")
      4. Afficher le menu (Commande: "Menu")

      Message de l'utilisateur : "${text}"
      
      Consignes :
      - Si l'utilisateur dit "Salut" ou "Bonjour", réponds poliment et demande comment tu peux aider.
      - Si l'utilisateur demande comment faire quelque chose (ex: "Comment créer un devis ?"), explique-lui qu'il doit simplement dire "Je veux créer un devis" pour lancer la procédure.
      - Ne fais PAS semblant de pouvoir faire des choses impossibles (ex: "Je vais analyser vos besoins"). Dis simplement la commande à taper.
      - Sois concis et direct.
    `;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: process.env.GROQ_MODEL_MAIN || 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: 'Tu es un assistant WhatsApp efficace. Tu guides l\'utilisateur vers les commandes existantes.' },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 150,
                temperature: 0.5,
            }),
        });

        if (!response.ok) throw new Error(`Erreur API Groq: ${response.status}`);

        const data = await response.json();
        const reply = data.choices[0].message.content.trim();

        await sendWhatsAppText(from, reply);

    } catch (error) {
        console.error('Erreur handleChat:', error);
        await sendWhatsAppText(from, "Je suis un peu fatigué... Je n'ai pas compris. Tapez /menu pour voir mes commandes.");
    }
}
