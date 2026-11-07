import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { ToBoolean } from './common.dto';

/** Query de GET /staff-members. */
export class ListStaffMembersQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeInactive?: boolean;
}

/** StaffMemberInput (POST /staff-members). */
export class StaffMemberInputDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName!: string;

  @IsOptional()
  @IsUUID('all')
  userId?: string | null;

  @IsOptional()
  @IsBoolean()
  isBonusEligible?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string | null;
}

/** StaffMemberPatch (PATCH /staff-members/{id}). */
export class StaffMemberPatchDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  displayName?: string;

  @IsOptional()
  @IsUUID('all')
  userId?: string | null;

  @IsOptional()
  @IsBoolean()
  isBonusEligible?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string | null;
}
