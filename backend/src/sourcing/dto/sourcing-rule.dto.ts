import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { OrderChannel, SourcingStrategy } from '@prisma/client';

export class CreateSourcingRuleDto {
  @IsString() name!: string;
  @IsOptional() @IsEnum(OrderChannel) channel?: OrderChannel;
  @IsOptional() @IsString() region?: string;
  @IsEnum(SourcingStrategy) strategy!: SourcingStrategy;
  @IsOptional() @IsBoolean() allowSplit?: boolean;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateSourcingRuleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(OrderChannel) channel?: OrderChannel;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsEnum(SourcingStrategy) strategy?: SourcingStrategy;
  @IsOptional() @IsBoolean() allowSplit?: boolean;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
