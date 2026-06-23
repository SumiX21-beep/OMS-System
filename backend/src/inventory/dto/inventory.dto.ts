import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  NotEquals,
} from 'class-validator';
import { InboundStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

export class ReceiveStockDto {
  @IsString() skuId!: string;
  @IsString() locationId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() reason?: string;
}

export class AdjustStockDto {
  @IsString() skuId!: string;
  @IsString() locationId!: string;
  @IsInt() @NotEquals(0) delta!: number;
  @IsOptional() @IsString() reason?: string;
}

export class SafetyStockDto {
  @IsString() skuId!: string;
  @IsString() locationId!: string;
  @IsInt() @Min(0) safetyStock!: number;
}

export class TransferStockDto {
  @IsString() skuId!: string;
  @IsString() fromLocationId!: string;
  @IsString() toLocationId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsString() reason?: string;
}

export class InboundDto {
  @IsString() skuId!: string;
  @IsString() locationId!: string;
  @IsInt() @Min(1) quantity!: number;
  /** ETA — only inbound within the ATP horizon counts toward availableToPromise. */
  @IsOptional() @IsDateString() expectedAt?: string;
  @IsOptional() @IsString() reference?: string;
}

export class ReceiveInboundDto {
  @IsString() inboundId!: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
}

export class AvailabilityQueryDto {
  @IsString() skuId!: string;
  @IsOptional() @IsString() locationId?: string;
  /** When set, returns the per-location breakdown instead of a single rollup. */
  @IsOptional() @Type(() => Boolean) breakdown?: boolean;
}

export class SnapshotListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() skuId?: string;
  @IsOptional() @IsString() locationId?: string;
}

export class InboundListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() skuId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsEnum(InboundStatus) status?: InboundStatus;
}
