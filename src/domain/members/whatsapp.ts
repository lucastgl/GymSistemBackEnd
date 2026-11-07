import { PhoneNumber } from '../shared/phone-number';
import { Errors, ErrorCodes } from '../shared/errors';

/**
 * Link de WhatsApp (`getWhatsappLinkSocio`, HU-SOC-06): `https://wa.me/<E.164 sin +>?text=<plantilla>`.
 * `{nombre}` se reemplaza por el primer nombre del socio. Sin teléfono normalizable → 409.
 */
export function buildWhatsappLink(
  phone: PhoneNumber,
  firstName: string,
  templateText: string,
): { url: string; message: string } {
  const digits = phone.whatsappDigits();
  if (!digits) {
    throw Errors.conflict(ErrorCodes.MEMBER_PHONE_INVALID, 'El socio no tiene un teléfono válido para WhatsApp');
  }
  const name = firstName.trim().split(/\s+/)[0] ?? '';
  const message = templateText.replace(/\{nombre\}/g, name);
  return { url: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`, message };
}
