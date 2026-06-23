import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AskDto {
  @IsString() @MaxLength(1000) question!: string;
}

export class ForecastQueryDto {
  @IsString() skuId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) horizonDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) lookbackDays?: number;
}
