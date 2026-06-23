import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderChannel, OrderStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

export class OrderListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsEnum(OrderChannel) channel?: OrderChannel;
}

export class OrderLineDto {
  @IsString() skuId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsInt() @Min(0) unitPrice?: number;
}

export class CreateOrderDto {
  @IsEnum(OrderChannel) channel!: OrderChannel;
  @IsOptional() @IsString() externalRef?: string;
  @IsOptional() @IsString() customerRef?: string;
  @IsOptional() @IsString() currency?: string;

  @IsOptional() @IsNumber() shipToLatitude?: number;
  @IsOptional() @IsNumber() shipToLongitude?: number;
  @IsOptional() @IsString() shipToRegion?: string;

  @IsOptional() @IsBoolean() allowSplit?: boolean;
  @IsOptional() @IsBoolean() allowBackorder?: boolean;

  /**
   * Soft-reserve stock at order creation. The reservation picks the best
   * stocked node per line (see ReservationService.reserveForOrder).
   */
  @IsOptional() @IsBoolean() reserveOnCreate?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];
}
