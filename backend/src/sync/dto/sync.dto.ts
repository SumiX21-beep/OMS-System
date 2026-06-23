import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ChannelType, OutboxStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

export class OutboxListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsEnum(OutboxStatus) status?: OutboxStatus;
}

export class CreateChannelDto {
  @IsEnum(ChannelType) type!: ChannelType;
  @IsString() name!: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}

export class ChangesQueryDto {
  /** Return changes with seq strictly greater than this cursor. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) since?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit?: number;
}
