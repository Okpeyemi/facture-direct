import { NextRequest } from 'next/server';
import { handleIncomingMessage } from '@/lib/bot/index';
import { sendWhatsAppText } from '@/lib/whatsapp-utils';

export async function GET() {
  return new Response('OK', { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    const params = await req.formData();

    const from = params.get('From') as string;
    const body = (params.get('Body') as string)?.trim() || '';
    const numMedia = parseInt(params.get('NumMedia') as string || '0');
    const mediaUrl = params.get('MediaUrl0') as string;

    console.log(`[Webhook] Reçu de ${from}: "${body}" (Media: ${numMedia})`);

    // IMPORTANT : On lance le traitement en arrière-plan pour répondre à Twilio immédiatement
    // Cela évite l'erreur de timeout (5 secondes max)
    processWorkflow(from, body, numMedia, mediaUrl).catch(err => {
      console.error("Erreur dans le workflow asynchrone:", err);
    });

    // Réponse immédiate à Twilio
    return new Response('Demande en cours de traitement...', { status: 200 });
  } catch (error) {
    console.error('Erreur réception Webhook:', error);
    return new Response('Error', { status: 500 });
  }
}

async function processWorkflow(from: string, body: string, numMedia: number, mediaUrl: string | null) {
  console.log(`[Workflow] Début traitement pour ${from}`);
  let text = body;
  let isVoice = false;

  // 1. Gestion du message vocal
  if (numMedia > 0 && mediaUrl) {
    isVoice = true;
    try {
      await sendWhatsAppText(from, '🔄 Message vocal reçu, transcription en cours...');

      // Authentification pour télécharger le média Twilio
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

      const audioRes = await fetch(mediaUrl, {
        headers: { 'Authorization': `Basic ${auth}` }
      });

      if (!audioRes.ok) throw new Error(`Erreur téléchargement Twilio: ${audioRes.status}`);

      const audioBuffer = await audioRes.arrayBuffer();

      // 2. Envoi à Groq Whisper
      const formData = new FormData();
      formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'fr');
      formData.append('response_format', 'text');

      const transcriptionRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: formData,
      });

      if (!transcriptionRes.ok) {
        const errorData = await transcriptionRes.text();
        throw new Error(`Erreur Groq: ${errorData}`);
      }

      text = (await transcriptionRes.text()).trim();
      console.log('Transcription Groq:', text);
      await sendWhatsAppText(from, `✅ Transcrit : "${text}"`);

    } catch (error) {
      console.error('Erreur transcription détaillée:', error);
      await sendWhatsAppText(from, '❌ Désolé, je n\'ai pas pu transcrire votre message vocal.');
      return; // On arrête si la voix est le seul message et qu'elle échoue
    }
  }

  // 3. Traitement final (IA / Logique métier)
  if (text) {
    console.log(`[Workflow] Envoi à handleIncomingMessage: "${text}"`);
    await handleIncomingMessage({ from, text, isVoice });
  } else {
    console.warn(`[Workflow] Aucun texte à traiter pour ${from}`);
  }
}