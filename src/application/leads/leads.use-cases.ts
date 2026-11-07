import {
  assertLeadContact,
  assertLostReason,
  isInProgress,
  isValidTime,
  LEAD_BOARD_STAGES,
  LEAD_CLOSED_STAGES,
  stageRequiresReason,
} from '../../domain/leads/lead-rules';
import { Clock } from '../../domain/ports/ports';
import { TransactionContext, UnitOfWork } from '../../domain/ports/unit-of-work';
import { LeadData, Repositories } from '../../domain/repositories/repositories';
import { DateOnly } from '../../domain/shared/date-only';
import { LEAD_STAGES, LeadChannel, LeadStage } from '../../domain/shared/enums';
import { Errors } from '../../domain/shared/errors';
import { round1 } from '../../domain/shared/money';
import { Period } from '../../domain/shared/period';
import { PhoneNumber } from '../../domain/shared/phone-number';
import { RequestContext } from '../../domain/shared/request-context';
import { cleanMultiline, cleanText, formatCode } from '../../domain/shared/text';
import { leadLabel, leadSnapshot } from '../common/audit-snapshots';
import { loadSettings, requireUserId } from '../common/helpers';
import { LeadView, leadView } from '../common/views';

export interface LeadInput {
  contactedOn?: string;
  firstName?: string;
  lastName?: string | null;
  phone?: string | null;
  channel?: LeadChannel;
  channelDetail?: string | null;
  trialClassOn?: string | null;
  trialClassTime?: string | null;
  stage?: LeadStage;
  handledByUserId?: string | null;
  lostReason?: string | null;
  notes?: string | null;
  memberId?: string | null;
}

async function assertRefs(
  tx: Pick<TransactionContext, 'users' | 'members'>,
  refs: { handledByUserId?: string | null; memberId?: string | null },
): Promise<void> {
  if (refs.handledByUserId) {
    if (!(await tx.users.findById(refs.handledByUserId))) throw Errors.field('handledByUserId', 'El usuario no existe', refs.handledByUserId);
  }
  if (refs.memberId) {
    const m = await tx.members.findById(refs.memberId);
    if (!m || m.deletedAt !== null) throw Errors.field('memberId', 'El socio no existe', refs.memberId);
  }
}

function parseTime(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isValidTime(value)) throw Errors.field('trialClassTime', 'Hora inválida (HH:mm)', value);
  return value;
}

export interface LeadsBoardView {
  stages: LeadStage[];
  closedStages: LeadStage[];
  visibleDays: number;
  counts: Record<string, number>;
  items: LeadView[];
}

/** GET /leads (HU-LEAD-01): por defecto los últimos `leads.visible_days` días. */
export class ListLeadsUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(input: { all?: boolean; stage?: LeadStage; q?: string }): Promise<LeadsBoardView> {
    const settings = await loadSettings(this.repos);
    const visibleDays = settings.leadsVisibleDays;
    const contactedFrom = input.all ? null : DateOnly.addDays(this.clock.today(), -visibleDays);
    const visible = await this.repos.leads.list({ contactedFrom, stage: null, q: cleanText(input.q ?? null) });
    const counts: Record<string, number> = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0]));
    for (const l of visible) counts[l.stage] = (counts[l.stage] ?? 0) + 1;
    const items = input.stage ? visible.filter((l) => l.stage === input.stage) : visible;
    return {
      stages: [...LEAD_BOARD_STAGES],
      closedStages: [...LEAD_CLOSED_STAGES],
      visibleDays,
      counts,
      items: items.map(leadView),
    };
  }
}

/** POST /leads (HU-LEAD-02). */
export class CreateLeadUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: LeadInput): Promise<LeadView> {
    const userId = requireUserId(ctx);
    const firstName = cleanText(input.firstName);
    if (!firstName) throw Errors.field('firstName', 'El nombre es obligatorio');
    const phone = PhoneNumber.parse(input.phone ?? null);
    const channel = input.channel ?? 'OTHER';
    const channelDetail = cleanText(input.channelDetail ?? null);
    assertLeadContact({ phone: phone.raw, channel, channelDetail });
    const stage = input.stage ?? 'FIRST_MESSAGE';
    const lostReason = stageRequiresReason(stage) ? cleanText(input.lostReason ?? null) : null;
    assertLostReason(stage, lostReason);
    const today = this.clock.today();
    const contactedOn = input.contactedOn ? DateOnly.parse(input.contactedOn, 'contactedOn') : today;
    if (contactedOn > today) throw Errors.field('contactedOn', 'La fecha de contacto no puede ser futura', contactedOn);
    const data: LeadData = {
      contactedOn,
      firstName,
      lastName: cleanText(input.lastName ?? null),
      phoneRaw: phone.raw,
      phoneE164: phone.e164,
      channel,
      channelDetail,
      trialClassOn: input.trialClassOn ? DateOnly.parse(input.trialClassOn, 'trialClassOn') : null,
      trialClassTime: parseTime(input.trialClassTime),
      stage,
      handledByUserId: input.handledByUserId === undefined ? userId : input.handledByUserId,
      handledByName: null,
      lostReason,
      notes: cleanMultiline(input.notes ?? null),
      memberId: input.memberId ?? null,
    };
    return this.uow.run(async (tx) => {
      await assertRefs(tx, data);
      const legacyCode = formatCode('L', await tx.sequences.next('lead'), 4);
      const created = await tx.leads.create({ ...data, legacyCode, createdById: userId });
      await tx.audit.log({ entity: 'LEAD', entityId: created.id, entityLabel: leadLabel(created), action: 'CREATE', after: leadSnapshot(created) }, ctx);
      return leadView(created);
    });
  }
}

/** PATCH /leads/{id}. */
export class UpdateLeadUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: string, input: LeadInput): Promise<LeadView> {
    const userId = requireUserId(ctx);
    return this.uow.run(async (tx) => {
      const lead = await tx.leads.findById(id);
      if (!lead || lead.deletedAt !== null) throw Errors.notFound('Lead');
      const patch: Partial<LeadData> = {};
      if (input.firstName !== undefined) {
        const firstName = cleanText(input.firstName);
        if (!firstName) throw Errors.field('firstName', 'El nombre es obligatorio');
        patch.firstName = firstName;
      }
      if (input.lastName !== undefined) patch.lastName = cleanText(input.lastName);
      if (input.phone !== undefined) {
        const phone = PhoneNumber.parse(input.phone);
        patch.phoneRaw = phone.raw;
        patch.phoneE164 = phone.e164;
      }
      if (input.channel !== undefined) patch.channel = input.channel;
      if (input.channelDetail !== undefined) patch.channelDetail = cleanText(input.channelDetail);
      if (input.contactedOn !== undefined) {
        const contactedOn = DateOnly.parse(input.contactedOn, 'contactedOn');
        if (contactedOn > this.clock.today()) throw Errors.field('contactedOn', 'La fecha de contacto no puede ser futura', contactedOn);
        patch.contactedOn = contactedOn;
      }
      if (input.trialClassOn !== undefined) patch.trialClassOn = input.trialClassOn ? DateOnly.parse(input.trialClassOn, 'trialClassOn') : null;
      if (input.trialClassTime !== undefined) patch.trialClassTime = parseTime(input.trialClassTime);
      if (input.stage !== undefined) patch.stage = input.stage;
      if (input.lostReason !== undefined) patch.lostReason = cleanText(input.lostReason);
      if (input.handledByUserId !== undefined) patch.handledByUserId = input.handledByUserId;
      if (input.notes !== undefined) patch.notes = cleanMultiline(input.notes);
      if (input.memberId !== undefined) patch.memberId = input.memberId;

      const finalStage = patch.stage ?? lead.stage;
      if (!stageRequiresReason(finalStage)) patch.lostReason = null;
      assertLostReason(finalStage, patch.lostReason !== undefined ? patch.lostReason : lead.lostReason);
      assertLeadContact({
        phone: patch.phoneRaw !== undefined ? patch.phoneRaw : lead.phoneRaw,
        channel: patch.channel ?? lead.channel,
        channelDetail: patch.channelDetail !== undefined ? patch.channelDetail : lead.channelDetail,
      });
      await assertRefs(tx, { handledByUserId: patch.handledByUserId, memberId: patch.memberId });
      const updated = await tx.leads.update(id, { ...patch, updatedById: userId });
      await tx.audit.log(
        { entity: 'LEAD', entityId: id, entityLabel: leadLabel(updated), action: 'UPDATE', before: leadSnapshot(lead), after: leadSnapshot(updated) },
        ctx,
      );
      return leadView(updated);
    });
  }
}

/** POST /leads/{id}/stage: mover de etapa (motivo obligatorio para Perdido / No le interesó). */
export class MoveLeadStageUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(
    ctx: RequestContext,
    id: string,
    input: { stage: LeadStage; lostReason?: string; memberId?: string },
  ): Promise<LeadView> {
    const userId = requireUserId(ctx);
    const lostReason = stageRequiresReason(input.stage) ? cleanText(input.lostReason ?? null) : null;
    assertLostReason(input.stage, lostReason);
    return this.uow.run(async (tx) => {
      const lead = await tx.leads.findById(id);
      if (!lead || lead.deletedAt !== null) throw Errors.notFound('Lead');
      const patch: Partial<LeadData> = { stage: input.stage, lostReason };
      if (input.memberId !== undefined) {
        if (input.stage !== 'SIGNED_UP') throw Errors.field('memberId', 'Solo se vincula un socio al pasar a "Se anotó"');
        await assertRefs(tx, { memberId: input.memberId });
        patch.memberId = input.memberId;
      }
      const updated = await tx.leads.update(id, { ...patch, updatedById: userId });
      await tx.audit.log(
        { entity: 'LEAD', entityId: id, entityLabel: leadLabel(updated), action: 'UPDATE', before: leadSnapshot(lead), after: leadSnapshot(updated) },
        ctx,
      );
      return leadView(updated);
    });
  }
}

/** DELETE /leads/{id}: baja lógica. */
export class DeleteLeadUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<void> {
    const userId = requireUserId(ctx);
    await this.uow.run(async (tx) => {
      const lead = await tx.leads.findById(id);
      if (!lead || lead.deletedAt !== null) throw Errors.notFound('Lead');
      const updated = await tx.leads.update(id, { deletedAt: this.clock.now(), updatedById: userId });
      await tx.audit.log(
        { entity: 'LEAD', entityId: id, entityLabel: leadLabel(lead), action: 'DELETE', before: leadSnapshot(lead), after: leadSnapshot(updated) },
        ctx,
      );
    });
  }
}

export interface LeadsSummaryCore {
  period: string;
  total: number;
  signedUp: number;
  inProgress: number;
  lost: number;
  notInterested: number;
  signedUpPct: number | null;
  inProgressPct: number | null;
  notClosedPct: number | null;
  byStage: Record<string, number>;
}

export function summarizeLeads(period: Period, rows: { stage: LeadStage }[]): LeadsSummaryCore {
  const byStage: Record<string, number> = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0]));
  for (const r of rows) byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
  const total = rows.length;
  const pct = (n: number): number | null => (total === 0 ? null : round1((n / total) * 100));
  const inProgress = rows.filter((r) => isInProgress(r.stage)).length;
  const lost = byStage.LOST ?? 0;
  const notInterested = byStage.NOT_INTERESTED ?? 0;
  const signedUp = byStage.SIGNED_UP ?? 0;
  return {
    period,
    total,
    signedUp,
    inProgress,
    lost,
    notInterested,
    signedUpPct: pct(signedUp),
    inProgressPct: pct(inProgress),
    notClosedPct: pct(lost + notInterested),
    byStage,
  };
}

/** GET /leads/summary (HU-LEAD-03): métricas del período y del mes anterior. */
export class GetLeadsSummaryUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  async execute(periodInput?: string): Promise<LeadsSummaryCore & { previous: LeadsSummaryCore }> {
    const period = periodInput ? Period.parse(periodInput) : Period.ofDate(this.clock.today());
    const prev = Period.previous(period);
    const [cur, before] = await Promise.all([
      this.repos.leads.listContactedBetween(Period.first(period), Period.last(period)),
      this.repos.leads.listContactedBetween(Period.first(prev), Period.last(prev)),
    ]);
    return { ...summarizeLeads(period, cur), previous: summarizeLeads(prev, before) };
  }
}
