import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Address } from '../../api/types';

export type AddressInput = {
  label: string;
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
  phone: string;
  lat?: number;
  lng?: number;
  isDefault?: boolean;
};

export function useAddresses(enabled = true) {
  return useQuery({ queryKey: ['addresses'], queryFn: () => api<Address[]>('/me/addresses'), enabled });
}

export function useSaveAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AddressInput & { id?: string }) =>
      api<Address>(id ? `/me/addresses/${id}` : '/me/addresses', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/me/addresses/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
}

export const formatAddress = (a: Pick<Address, 'line1' | 'line2' | 'city' | 'pincode'>) =>
  [a.line1, a.line2, `${a.city} ${a.pincode}`].filter(Boolean).join(', ');
