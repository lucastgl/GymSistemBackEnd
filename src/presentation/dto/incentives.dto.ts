import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { IsPeriod } from './common.dto';

const number2 = { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false } as const;
const number4 = { maxDecimalPlaces: 4, allowNaN: false, allowInfinity: false } as const;

/** Query de GET /incentives/history. */
export class IncentivesHistoryQueryDto {
  @IsOptional()
  @IsPeriod()
  from?: string;

  @IsOptional()
  @IsPeriod()
  to?: string;
}

/** Query de GET /incentives/plan: `period` + los 9 reemplazos del simulador (IncentiveOverrides). */
export class IncentivePlanQueryDto {
  @IsOptional()
  @IsPeriod()
  period?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(number4)
  @Min(0)
  @Max(100)
  newMembersUpliftPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(number4)
  @Min(-100)
  @Max(100)
  renewalRateUpliftPts?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(number4)
  @Min(0)
  @Max(100)
  newMemberBonusPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(number4)
  @Min(0)
  @Max(100)
  teamBonusPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(number2)
  @Min(0)
  expenseReferenceArs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  newMembersTarget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(number4)
  @Min(0)
  @Max(100)
  renewalRateTargetPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(number2)
  @Min(0)
  bonusPerNewMemberArs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber(number2)
  @Min(0)
  teamBonusPerPersonArs?: number;
}

/** IncentiveOverrides en el body de publicar (números JSON, sin conversión). */
export class IncentiveOverridesDto {
  @IsOptional()
  @IsNumber(number4)
  @Min(0)
  @Max(100)
  newMembersUpliftPct?: number;

  @IsOptional()
  @IsNumber(number4)
  @Min(-100)
  @Max(100)
  renewalRateUpliftPts?: number;

  @IsOptional()
  @IsNumber(number4)
  @Min(0)
  @Max(100)
  newMemberBonusPct?: number;

  @IsOptional()
  @IsNumber(number4)
  @Min(0)
  @Max(100)
  teamBonusPct?: number;

  @IsOptional()
  @IsNumber(number2)
  @Min(0)
  expenseReferenceArs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  newMembersTarget?: number;

  @IsOptional()
  @IsNumber(number4)
  @Min(0)
  @Max(100)
  renewalRateTargetPct?: number;

  @IsOptional()
  @IsNumber(number2)
  @Min(0)
  bonusPerNewMemberArs?: number;

  @IsOptional()
  @IsNumber(number2)
  @Min(0)
  teamBonusPerPersonArs?: number;
}

/** PublishIncentivePeriodRequest. */
export class PublishIncentivePeriodDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => IncentiveOverridesDto)
  overrides?: IncentiveOverridesDto;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  replace?: boolean;

  @IsOptional()
  @IsBoolean()
  acceptNegativeResult?: boolean;
}

/** CloseIncentivePeriodRequest. */
export class CloseIncentivePeriodDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
