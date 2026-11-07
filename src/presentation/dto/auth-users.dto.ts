import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ROLES, Role } from '../../domain/shared/enums';
import { PageQueryDto, ToBoolean } from './common.dto';

/** LoginRequest. */
export class LoginDto {
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(200)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

/** Body de /auth/refresh y /auth/logout. */
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  refreshToken!: string;
}

/** Body de /auth/change-password. */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: 'Debe tener al menos 10 caracteres' })
  @MaxLength(200)
  newPassword!: string;
}

/** Query de GET /users. */
export class ListUsersQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

/** CreateUserRequest. */
export class CreateUserDto {
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsIn(ROLES)
  role!: Role;
}

/** UpdateUserRequest. */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
