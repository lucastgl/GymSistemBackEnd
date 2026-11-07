import { LEAD_STAGES, LeadChannel, LeadStage } from '../shared/enums';
import { Errors } from '../shared/errors';

/** Orden visual del tablero (`LEAD_ETAPAS`). */
export const LEAD_BOARD_STAGES: readonly LeadStage[] = LEAD_STAGES;

/** Etapas cerradas (`LEAD_ETAPAS_CERRADAS`). */
export const LEAD_CLOSED_STAGES: readonly LeadStage[] = ['SIGNED_UP', 'LOST', 'NOT_INTERESTED'];

/** Etapas que exigen motivo (HU-LEAD-02). */
export function stageRequiresReason(stage: LeadStage): boolean {
  return stage === 'LOST' || stage === 'NOT_INTERESTED';
}

/** "En proceso" para las métricas: Primer mensaje, Segundo mensaje, Vino a clase. */
export function isInProgress(stage: LeadStage): boolean {
  return stage === 'FIRST_MESSAGE' || stage === 'SECOND_MESSAGE' || stage === 'TRIAL_ATTENDED';
}

/**
 * Teléfono o canal obligatorio (`crearLead`): sin teléfono, el canal tiene que ser uno concreto
 * (distinto de OTHER) o venir con detalle (docs/05 LeadInput.phone).
 */
export function assertLeadContact(input: {
  phone: string | null;
  channel: LeadChannel;
  channelDetail: string | null;
}): void {
  if (input.phone) return;
  if (input.channel !== 'OTHER') return;
  if (input.channelDetail) return;
  throw Errors.field('phone', 'Indicá un teléfono o el canal de contacto');
}

export function assertLostReason(stage: LeadStage, lostReason: string | null): void {
  if (stageRequiresReason(stage) && !lostReason) {
    throw Errors.field('lostReason', 'Indicá el motivo para Perdido / No le interesó');
  }
}

/** `HH:mm` válido (00:00–23:59). */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
