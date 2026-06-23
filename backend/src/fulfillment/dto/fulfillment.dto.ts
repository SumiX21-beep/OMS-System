import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReturnStatus, ShipmentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

export class ShipmentListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ShipmentStatus) status?: ShipmentStatus;
  @IsOptional() @IsString() orderId?: string;
}

export class ReturnListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(ReturnStatus) status?: ReturnStatus;
  @IsOptional() @IsString() orderId?: string;
}

export class ShipShipmentDto {
  @IsOptional() @IsString() carrier?: string;
}

export class ReturnLineDto {
  @IsString() orderLineId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsBoolean() restock?: boolean;
  @IsOptional() @IsString() locationId?: string;
}

export class CreateReturnDto {
  @IsString() orderId!: string;
  @IsOptional() @IsString() reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}
