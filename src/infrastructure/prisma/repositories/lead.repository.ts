import { Lead, Prisma } from '@prisma/client';
import { LeadRecord } from '../../../domain/repositories/records';
import { LeadData, LeadFilter, LeadRepository } from '../../../domain/repositories/repositories';
import { DateOnly } from '../../../domain/shared/date-only';
import { LeadChannel, LeadStage } from '../../../domain/shared/enums';
import {
  auditMeta,
  Db,
  fromDateOnly,
  fromDateOnlyOrNull,
  refOf,
  stringToTime,
  timeToString,
  toDateOnly,
  toDateOnlyOrNull,
  userRefs,
} from '../support';

async function toRecords(db: Db, rows: Lead[]): Promise<LeadRecord[]> {
  const users = await userRefs(db, rows.flatMap((r) => [r.createdById, r.updatedById, r.handledByUserId]));
  return rows.map((l) => ({
    id: l.id,
    legacyCode: l.legacyCode,
    contactedOn: toDateOnly(l.contactedOn),
    firstName: l.firstName,
    lastName: l.lastName,
    phoneRaw: l.phoneRaw,
    phoneE164: l.phoneE164,
    channel: l.channel as LeadChannel,
    channelDetail: l.channelDetail,
    trialClassOn: toDateOnlyOrNull(l.trialClassOn),
    trialClassTime: timeToString(l.trialClassTime),
    stage: l.stage as LeadStage,
    handledByUserId: l.handledByUserId,
    handledBy: refOf(users, l.handledByUserId),
    handledByName: l.handledByName,
    lostReason: l.lostReason,
    notes: l.notes,
    memberId: l.memberId,
    deletedAt: l.deletedAt,
    audit: auditMeta(users, l),
  }));
}

function dataOf(d: Partial<LeadData>): Prisma.LeadUncheckedUpdateInput {
  const out: Prisma.LeadUncheckedUpdateInput = {};
  if (d.contactedOn !== undefined) out.contactedOn = fromDateOnly(d.contactedOn);
  if (d.firstName !== undefined) out.firstName = d.firstName;
  if (d.lastName !== undefined) out.lastName = d.lastName;
  if (d.phoneRaw !== undefined) out.phoneRaw = d.phoneRaw;
  if (d.phoneE164 !== undefined) out.phoneE164 = d.phoneE164;
  if (d.channel !== undefined) out.channel = d.channel;
  if (d.channelDetail !== undefined) out.channelDetail = d.channelDetail;
  if (d.trialClassOn !== undefined) out.trialClassOn = fromDateOnlyOrNull(d.trialClassOn);
  if (d.trialClassTime !== undefined) out.trialClassTime = stringToTime(d.trialClassTime);
  if (d.stage !== undefined) out.stage = d.stage;
  if (d.handledByUserId !== undefined) out.handledByUserId = d.handledByUserId;
  if (d.handledByName !== undefined) out.handledByName = d.handledByName;
  if (d.lostReason !== undefined) out.lostReason = d.lostReason;
  if (d.notes !== undefined) out.notes = d.notes;
  if (d.memberId !== undefined) out.memberId = d.memberId;
  return out;
}

export class PrismaLeadRepository implements LeadRepository {
  constructor(private readonly db: Db) {}

  async list(filter: LeadFilter): Promise<LeadRecord[]> {
    const q = filter.q;
    const rows = await this.db.lead.findMany({
      where: {
        deletedAt: null,
        ...(filter.contactedFrom ? { contactedOn: { gte: fromDateOnly(filter.contactedFrom) } } : {}),
        ...(filter.stage ? { stage: filter.stage } : {}),
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { phoneRaw: { contains: q } },
                { legacyCode: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ contactedOn: 'desc' }, { createdAt: 'desc' }],
    });
    return toRecords(this.db, rows);
  }

  async listContactedBetween(from: DateOnly, to: DateOnly): Promise<{ stage: LeadStage; contactedOn: DateOnly }[]> {
    const rows = await this.db.lead.findMany({
      where: { deletedAt: null, contactedOn: { gte: fromDateOnly(from), lte: fromDateOnly(to) } },
      select: { stage: true, contactedOn: true },
    });
    return rows.map((r) => ({ stage: r.stage as LeadStage, contactedOn: toDateOnly(r.contactedOn) }));
  }

  async findById(id: string): Promise<LeadRecord | null> {
    const row = await this.db.lead.findUnique({ where: { id } });
    return row ? (await toRecords(this.db, [row]))[0]! : null;
  }

  async create(data: LeadData & { legacyCode: string; createdById: string | null }): Promise<LeadRecord> {
    const row = await this.db.lead.create({
      data: {
        ...(dataOf(data) as Prisma.LeadUncheckedCreateInput),
        legacyCode: data.legacyCode,
        contactedOn: fromDateOnly(data.contactedOn),
        firstName: data.firstName,
        createdById: data.createdById,
        updatedById: data.createdById,
      },
    });
    return (await toRecords(this.db, [row]))[0]!;
  }

  async update(
    id: string,
    patch: Partial<LeadData> & { deletedAt?: Date | null; updatedById?: string | null },
  ): Promise<LeadRecord> {
    const data = dataOf(patch);
    if (patch.deletedAt !== undefined) data.deletedAt = patch.deletedAt;
    if (patch.updatedById !== undefined) data.updatedById = patch.updatedById;
    const row = await this.db.lead.update({ where: { id }, data });
    return (await toRecords(this.db, [row]))[0]!;
  }
}
