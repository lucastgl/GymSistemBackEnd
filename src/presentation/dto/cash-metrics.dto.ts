import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AuditAction,
  AuditEntity,
  LEAD_CHANNELS,
  LEAD_STAGES,
  LeadChannel,
  LeadStage,
  MEMBER_STATUSES,
  MemberStatus,
  MOVEMENT_ORIGINS,
  MOVEMENT_TYPES,
  MovementOrigin,
  MovementType,
  NUTRITION_BILLINGS,
  NutritionBilling,
  PAYMENT_METHODS,
  PaymentMethod,
  RECORD_STATUSES,
  RecordStatus,
} from '../../domain/shared/enums';
import { IsDateOnly, IsPeriod, PageQueryDto, ToArray, ToBoolean } from './common.dto';
import { PaymentSplitDto } from './members.dto';

// ───────────── Caja ─────────────

/** Filtros comunes de /cash/movements y /cash/summary. */
export class CashFilterQueryDto {
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsIn(MOVEMENT_TYPES)
  type?: MovementType;

  @IsOptional()
  @IsUUID('all')
  categoryId?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @IsOptional()
  @IsIn(MOVEMENT_ORIGINS)
  origin?: MovementOrigin;

  @IsOptional()
  @IsUUID('all')
  memberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsUUID('all')
  createdBy?: string;

  @IsOptional()
  @IsIn(RECORD_STATUSES)
  status?: RecordStatus;
}

/** Query de GET /cash/movements. */
export class ListCashMovementsQueryDto extends CashFilterQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  expandSplits?: boolean;
}

/** CreateCashMovementRequest (egreso: `confirmPassword` y `description` obligatorios). */
export class CreateCashMovementDto {
  @ValidateIf((o: CreateCashMovementDto) => o.type === 'EXPENSE')
  @IsString({ message: 'Ingresá tu contraseña para confirmar el egreso' })
  @IsNotEmpty({ message: 'Ingresá tu contraseña para confirmar el egreso' })
  @MaxLength(200)
  confirmPassword?: string;

  @IsIn(MOVEMENT_TYPES)
  type!: MovementType;

  @IsOptional()
  @IsDateOnly()
  occurredOn?: string;

  @IsUUID('all')
  categoryId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  subcategory?: string;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @IsPositive()
  amount!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PaymentSplitDto)
  splits!: PaymentSplitDto[];

  @ValidateIf((o: CreateCashMovementDto) => o.type === 'EXPENSE' || (o.description !== undefined && o.description !== null))
  @IsString({ message: 'La descripción es obligatoria para un egreso' })
  @IsNotEmpty({ message: 'La descripción es obligatoria para un egreso' })
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUUID('all')
  memberId?: string | null;
}

/** UpdateCashMovementRequest. */
export class UpdateCashMovementDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  confirmPassword?: string;

  @IsOptional()
  @IsDateOnly()
  occurredOn?: string;

  @IsOptional()
  @IsUUID('all')
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  subcategory?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PaymentSplitDto)
  splits?: PaymentSplitDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsUUID('all')
  memberId?: string | null;
}

/** CashVoidRequest. */
export class CashVoidDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  confirmPassword?: string;
}

// ───────────── Métricas ─────────────

/** Query de GET /metrics/history. */
export class MetricsHistoryQueryDto {
  @IsOptional()
  @IsPeriod()
  from?: string;

  @IsOptional()
  @IsPeriod()
  to?: string;

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  keys?: string[];
}

/** Body de POST /metrics/close. */
export class CloseMetricsPeriodDto {
  @IsPeriod()
  period!: string;

  @IsOptional()
  @IsBoolean()
  replace?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

// ───────────── Nutrición ─────────────

/** Query de GET /nutrition/members. */
export class NutritionMembersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(MEMBER_STATUSES)
  status?: MemberStatus;

  @IsOptional()
  @IsIn(NUTRITION_BILLINGS)
  nutritionBilling?: NutritionBilling;
}

// ───────────── Leads ─────────────

/** Query de GET /leads. */
export class ListLeadsQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsIn(LEAD_STAGES)
  stage?: LeadStage;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

const HHMM = /^\d{2}:\d{2}$/;

/** LeadInput. */
export class LeadInputDto {
  @IsOptional()
  @IsDateOnly()
  contactedOn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsIn(LEAD_CHANNELS)
  channel?: LeadChannel;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  channelDetail?: string | null;

  @IsOptional()
  @IsDateOnly()
  trialClassOn?: string | null;

  @IsOptional()
  @IsString()
  @ValidateIf((o: LeadInputDto) => typeof o.trialClassTime === 'string')
  @Matches(HHMM, { message: 'Hora inválida (HH:mm)' })
  trialClassTime?: string | null;

  @IsOptional()
  @IsIn(LEAD_STAGES)
  stage?: LeadStage;

  @IsOptional()
  @IsUUID('all')
  handledByUserId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsUUID('all')
  memberId?: string | null;
}

/** Body de POST /leads/{id}/stage. */
export class MoveLeadStageDto {
  @IsIn(LEAD_STAGES)
  stage!: LeadStage;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  lostReason?: string;

  @IsOptional()
  @IsUUID('all')
  memberId?: string;
}

// ───────────── Auditoría y parámetros ─────────────

/** Query de GET /audit-logs. */
export class ListAuditLogsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(AUDIT_ENTITIES)
  entity?: AuditEntity;

  @IsOptional()
  @IsUUID('all')
  entityId?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: AuditAction;

  @IsOptional()
  @IsUUID('all')
  userId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Body de PATCH /settings. */
export class UpdateSettingsDto {
  @IsObject()
  values!: Record<string, unknown>;
}

/** Query de GET /metrics/snapshots. */
export class SnapshotsQueryDto {
  @IsOptional()
  @IsPeriod()
  period?: string;
}

