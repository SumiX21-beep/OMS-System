import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Location, Page, Sku } from '@/lib/types';

export function useSkus() {
  return useQuery({
    queryKey: ['skus'],
    queryFn: () => api.get<Page<Sku>>('/skus', { pageSize: 200 }),
  });
}

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Page<Location>>('/locations', { pageSize: 200 }),
  });
}
