// src/lib/bot/utils/phone.ts

export function normalizePhone(phone: string): string {
  return phone.replace('whatsapp:', '').replace(/^\+/, '');
}