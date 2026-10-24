import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { User } from '../../api/types';

/**
 * Who is logged in? This is SERVER state (the session lives in an httpOnly cookie
 * the page can't read), so we ask the API: GET /auth/me. A 401 just means "logged out".
 */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<User>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

type Credentials = { email: string; password: string };

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Credentials) =>
      api<User>('/auth/login', { method: 'POST', body: JSON.stringify(c) }),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Credentials & { name: string }) =>
      api<User>('/auth/register', { method: 'POST', body: JSON.stringify(c) }),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.removeQueries({ queryKey: ['orders'] });
      qc.removeQueries({ queryKey: ['admin'] });
      qc.setQueryData(['me'], null);
    },
  });
}
