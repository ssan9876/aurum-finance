/**
 * Typed React Query hooks over the storage client. Every list is cached per
 * entity; mutations invalidate just that entity's cache. Deletes get a
 * toast-with-Undo that re-inserts the original rows (ids preserved).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from './api';
import type { EntityMap, EntityName } from '@/shared/types';

export function useEntityList<E extends EntityName>(entity: E) {
  return useQuery({
    queryKey: [entity],
    queryFn: () => api.list(entity),
    staleTime: 60_000,
  });
}

export const useAccounts = () => useEntityList('account');
export const useIncomeSources = () => useEntityList('incomeSource');
export const useCategories = () => useEntityList('category');
export const useTransactions = () => useEntityList('transaction');
export const useSavingsAccounts = () => useEntityList('savingsAccount');
export const useSavingsSnapshots = () => useEntityList('savingsSnapshot');
export const useBudgets = () => useEntityList('budget');
export const useBills = () => useEntityList('bill');
export const useGoals = () => useEntityList('goal');
export const useTags = () => useEntityList('tag');
export const useSettingRows = () => useEntityList('setting');

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function useCreateEntity<E extends EntityName>(entity: E) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<EntityMap[E]>) => api.create(entity, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [entity] }),
    onError: (err) => toast.error(message(err)),
  });
}

export function useUpdateEntity<E extends EntityName>(entity: E) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EntityMap[E]> }) =>
      api.update(entity, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [entity] }),
    onError: (err) => toast.error(message(err)),
  });
}

export function useBulkUpdate<E extends EntityName>(entity: E) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, data }: { ids: string[]; data: Partial<EntityMap[E]> }) => {
      for (const id of ids) await api.update(entity, id, data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [entity] }),
    onError: (err) => toast.error(message(err)),
  });
}

/**
 * Delete rows and offer Undo for a few seconds. Pass the full rows (not just
 * ids) so Undo can re-insert them verbatim.
 */
export function useDeleteWithUndo<E extends EntityName>(entity: E) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: [entity] });

  return async (rows: EntityMap[E][], label?: string) => {
    if (rows.length === 0) return;
    try {
      await api.removeMany(entity, rows.map((r) => r.id));
      invalidate();
      toast(label ?? `Deleted ${rows.length} item${rows.length > 1 ? 's' : ''}`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await api.createMany(entity, rows);
              // Category/savings deletes cascade; refresh related caches too.
              qc.invalidateQueries();
            } catch (err) {
              toast.error(message(err));
            }
          },
        },
        duration: 6000,
      });
    } catch (err) {
      toast.error(message(err));
    }
  };
}

/** Invalidate everything — used after import/restore. */
export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
