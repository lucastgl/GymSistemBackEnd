import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ATTENDANCE_RISKS,
  AttendanceRisk,
  MEMBER_STATUSES,
  MemberStatus,
  PAYMENT_METHODS,
  PaymentMethod,
  RECORD_STATUSES,
  RecordStatus,
  RENEWAL_STATUSES,
  RenewalStatus,
  WHATSAPP_TEMPLATES,
  WhatsappTemplate,
} from '../../domain/shared/enums';
import { IsDateOnly, PageQueryDto, ToArray, ToBoolean } from './common.dto';

// ───────────── Socios ─────────────

/** Query de GET /members. */
export class ListMembersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(MEMBER_STATUSES)
  status?: MemberStatus;

  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(RENEWAL_STATUSES, { each: true })
  renewalStatus?: RenewalStatus[];

  @IsOptional()
  @IsUUID('all')
  planId?: string;

  @IsOptional()
  @IsDateOnly()
  renewedFrom?: string;

  @IsOptional()
  @IsDateOnly()
  renewedTo?: string;

  @IsOptional()
  @IsIn(['priority', 'lastName', 'expiresAt', 'lastRenewalAt', 'joinedAt'])
  sort?: 'priority' | 'lastName' | 'expiresAt' | 'lastRenewalAt' | 'joinedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

/** PaymentSplit. */
export class PaymentSplitDto {
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @IsPositive()
  amount!: number;
}

/** CreateMembershipRequest. */
export class CreateMembershipDto {
  @IsUUID('all')
  planId!: string;

  @IsDateOnly()
  paidOn!: string;

  @IsDateOnly()
  expiresOn!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PaymentSplitDto)
  splits!: PaymentSplitDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** CreateMemberRequest. */
export class CreateMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone!: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  email?: string | null;

  @IsUUID('all')
  planId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  acquisitionSource?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsOptional()
  @IsDateOnly()
  joinedAt?: string;

  /** Quién cerró la venta (Fase 4). Si no viene, la persona vinculada al usuario autenticado. */
  @IsOptional()
  @IsUUID('all')
  soldByStaffId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateMembershipDto)
  initialPayment?: CreateMembershipDto;
}

/** UpdateMemberRequest. */
export class UpdateMemberDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  email?: string | null;

  @IsOptional()
  @IsUUID('all')
  currentPlanId?: string;

  @IsOptional()
  @IsDateOnly()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  acquisitionSource?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  /** Solo ADMIN (403 para otros roles); null = "Sin asignar". */
  @IsOptional()
  @IsUUID('all')
  soldByStaffId?: string | null;
}

/** Body de POST /members/{id}/cancel. */
export class CancelMemberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsDateOnly()
  effectiveOn?: string;
}

/** Query de GET /members/{id}/whatsapp-link. */
export class WhatsappLinkQueryDto {
  @IsIn(WHATSAPP_TEMPLATES)
  template!: WhatsappTemplate;
}

/** Query de GET /members/{id}/memberships. */
export class IncludeVoidedQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeVoided?: boolean;
}

// ───────────── Renovaciones ─────────────

/** Query de GET /memberships. */
export class ListMembershipsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID('all')
  memberId?: string;

  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsUUID('all')
  planId?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @IsOptional()
  @IsIn(RECORD_STATUSES)
  status?: RecordStatus;
}

/** UpdateMembershipRequest. */
export class UpdateMembershipDto {
  @IsOptional()
  @IsUUID('all')
  planId?: string;

  @IsOptional()
  @IsDateOnly()
  paidOn?: string;

  @IsOptional()
  @IsDateOnly()
  expiresOn?: string;

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
  notes?: string;
}

/** VoidRequest. */
export class VoidDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

// ───────────── Asistencias ─────────────

/** Query de GET /attendances. */
export class ListAttendancesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @IsUUID('all')
  memberId?: string;

  @IsOptional()
  @IsIn(RECORD_STATUSES)
  status?: RecordStatus;
}

/** CreateAttendanceRequest. */
export class CreateAttendanceDto {
  @IsUUID('all')
  memberId!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  checkedInAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** Query de GET /attendances/search-members. */
export class SearchMembersQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

/** Query de GET /attendances/risk. */
export class AttendanceRiskQueryDto extends PageQueryDto {
  @IsOptional()
  @ToArray()
  @IsArray()
  @IsIn(ATTENDANCE_RISKS, { each: true })
  risk?: AttendanceRisk[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

/** Body de PATCH /attendances/{id}. */
export class UpdateAttendanceDto {
  @IsOptional()
  @IsUUID('all')
  memberId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  checkedInAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
