import { MembershipRole, PlatformRole, UserStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class SetDefaultCooperativeDto {
  @IsUUID() cooperativeId!: string;
}

export class ListUsersQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}

export class InvitePlatformUserDto {
  @IsEmail() email!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) displayName?: string;
  @IsEnum(PlatformRole) platformRole!: PlatformRole;
}

export class SetPlatformRoleDto {
  /** null removes platform access. */
  @IsOptional() @IsEnum(PlatformRole) platformRole!: PlatformRole | null;
}

export class SetUserStatusDto {
  @IsEnum(UserStatus) status!: UserStatus;
}

export class InviteMemberDto {
  @IsEmail() email!: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) displayName?: string;
  @IsEnum(MembershipRole) role!: MembershipRole;
}

export class UpdateMembershipDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'REVOKED']) status!: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
}
