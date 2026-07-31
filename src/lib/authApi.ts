import type { Role } from '@/lib/roles';

const AUTH_URL = 'https://functions.poehali.dev/eca1843f-b794-48c6-a9e6-4dead2174136';

export interface TestAccount {
  id: number;
  name: string;
  role: Role;
  workshopId: number | null;
  workshopName: string | null;
  shiftNumber: number | null;
}

export const fetchTestAccounts = async (): Promise<TestAccount[]> => {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test_accounts' }),
  });
  const data = await res.json();
  return data.accounts || [];
};

export { AUTH_URL };
