import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { OrderDetail, OrderSummary, Page } from '@/lib/types';

export function useOrders(params: {
  status?: string;
  channel?: string;
  search?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: ['orders', params],
    queryFn: () =>
      api.get<Page<OrderSummary>>('/orders', {
        ...params,
        page: params.page ?? 1,
        pageSize: 25,
      }),
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderDetail>(`/orders/${id}`),
  });
}

/** POST /orders/:id/:action or /shipments/:id/:action, then refresh the order. */
export function useAction(orderId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (input: { path: string; label: string }) =>
      api.post(input.path).then(() => input.label),
    onSuccess: (label) => {
      toast(`${label} done`);
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['report'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Action failed', 'error'),
  });
}
