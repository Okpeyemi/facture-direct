// src/lib/whatsapp-utils.ts

import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function sendWhatsAppText(to: string, text: string) {
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: text,
  });
}

export async function sendWhatsAppDocument(to: string, mediaUrl: string, filename: string, caption?: string) {
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: caption || 'Votre document',
    mediaUrl: [mediaUrl],
  });
}