import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Standard list query params: ?page=1&pageSize=25&search=foo */
export class PaginationQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
  @IsOptional() @IsString() search?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Resolve page/pageSize into Prisma skip/take with sane defaults & caps. */
export function toSkipTake(q: PaginationQueryDto): {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
} {
  const page = q.page && q.page > 0 ? q.page : 1;
  const pageSize = q.pageSize && q.pageSize > 0 ? Math.min(q.pageSize, 200) : 25;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function makePage<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Page<T> {
  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}
