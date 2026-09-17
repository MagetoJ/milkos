import { IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class StartVerificationDto {
  @IsEnum(['PHONE','GOOGLE','EMAIL']) channel!: 'PHONE'|'GOOGLE'|'EMAIL';
  @IsString() @MinLength(3) destination!: string;
}

export class VerifyContactDto {
  @IsString() verificationId!: string;
  @IsString() @MinLength(4) code!: string;
}

export class SubmitApplicationDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsString() @Matches(/^\\+?[1-9]\\d{7,14}$/) phone!: string;
  @IsOptional() @IsString() location?: string;
}

export class ReviewApplicationDto {
  @IsEnum(['APPROVED','REJECTED','MORE_INFORMATION_REQUIRED']) status!: 'APPROVED'|'REJECTED'|'MORE_INFORMATION_REQUIRED';
  @IsOptional() @IsString() notes?: string;
}
