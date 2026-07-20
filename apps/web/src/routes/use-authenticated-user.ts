import type { AuthenticatedUser } from '@execution/contracts';
import { useOutletContext } from 'react-router';

export function useAuthenticatedUser(): AuthenticatedUser {
  return useOutletContext<{ user: AuthenticatedUser }>().user;
}
