const VARIKI_URL = 'https://functions.poehali.dev/2ad91f9f-97d9-46d1-a9f4-06ee696d5ec5';

export interface MyVariki {
  variki: number;
  threshold: number;
  canPlay: boolean;
}

export interface VarikiPlayer {
  id: number;
  fullName: string;
  role: string;
  variki: number;
  canPlay: boolean;
}

export const fetchMyVariki = async (userId: number): Promise<MyVariki> => {
  const res = await fetch(`${VARIKI_URL}?userId=${userId}`);
  return res.json();
};

export const fetchVarikiPlayers = async (): Promise<{ players: VarikiPlayer[]; threshold: number }> => {
  const res = await fetch(`${VARIKI_URL}?players=1`);
  const data = await res.json();
  return { players: data.players || [], threshold: data.threshold || 0 };
};

export const debitVariki = async (userId: number, amount: number, actorId?: number) => {
  const res = await fetch(VARIKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'debit', userId, amount, actorId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось списать варики');
  }
  return data;
};
