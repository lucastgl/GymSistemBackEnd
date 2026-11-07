import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MOVEMENT_TYPES, MovementType, NUTRITION_BILLINGS, NutritionBilling } from '../../domain/shared/enums';
import { ToBoolean } from './common.dto';

/** Query de GET /plans. */
export class ListPlansQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeInactive?: boolean;
}

/** PlanInput. */
export class PlanInputDto {
  @IsOptional()
  @Matches(/^[A-Z0-9_]{2,20}$/, { message: 'Código inválido (mayúsculas, números y _; 2 a 20 caracteres)' })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceArs?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  enrollmentFeeArs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  durationDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresAdvance?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  advanceInstallments?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  benefits?: string;

  @IsOptional()
  @IsIn(NUTRITION_BILLINGS)
  nutritionBilling?: NutritionBilling;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** Query de GET /cash/categories. */
export class ListCategoriesQueryDto {
  @IsOptional()
  @IsIn(MOVEMENT_TYPES)
  type?: MovementType;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeInactive?: boolean;
}

/** CashCategoryInput. */
export class CashCategoryInputDto {
  @IsOptional()
  @IsIn(MOVEMENT_TYPES)
  type?: MovementType;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
