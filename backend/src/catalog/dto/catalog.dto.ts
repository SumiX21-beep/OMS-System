import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { LocationType } from '@prisma/client';

export class CreateSkuDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateSkuDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateLocationDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsEnum(LocationType) type!: LocationType;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsInt() @Min(0) fulfillmentPriority?: number;
  @IsOptional() @IsBoolean() shipFromEnabled?: boolean;
  @IsOptional() @IsBoolean() pickupEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) dailyOrderCapacity?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateLocationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsInt() @Min(0) fulfillmentPriority?: number;
  @IsOptional() @IsBoolean() shipFromEnabled?: boolean;
  @IsOptional() @IsBoolean() pickupEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) dailyOrderCapacity?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
