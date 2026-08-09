const PERSONAL_DATA_URL = 'https://functions.poehali.dev/ec5431c3-28ca-48c0-aabe-1ec7a5136923';

/** Тип документа, который сотрудник загружает в профиле. */
export type DocType = 'passport_main' | 'passport_registration' | 'snils';

export interface UserDocument {
  docType: DocType;
  label: string;
  /** Сам скан открывает только администратор — сотруднику приходит null. */
  fileUrl: string | null;
  fileName: string | null;
  uploadedAt: string;
}

export interface PersonalData {
  userId: number;
  fullName: string;
  phone: string | null;
  /** Телефон для выплат по СБП — вводит сам сотрудник. */
  sbpPhone: string | null;
  sbpBank: string | null;
  /** Админ сверил реквизиты. Без этого договор отправить нельзя. */
  sbpConfirmed: boolean;
  /** Админ сверил паспортные данные со сканом. */
  personalDataVerified: boolean;
  personalDataVerifiedAt: string | null;
  documents: UserDocument[];
  requiredDocs: { docType: DocType; label: string }[];
  /** Паспортные поля приходят только администратору. */
  passportSeries?: string | null;
  passportNumber?: string | null;
  passportIssuedBy?: string | null;
  passportIssuedDate?: string | null;
  passportDepartmentCode?: string | null;
  birthDate?: string | null;
  registrationAddress?: string | null;
  snils?: string | null;
  inn?: string | null;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(PERSONAL_DATA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

export const fetchPersonalData = async (
  userId: number,
  actorId: number
): Promise<PersonalData> => {
  const res = await fetch(
    `${PERSONAL_DATA_URL}?userId=${userId}&actorId=${actorId}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить данные');
  return data;
};

export const uploadUserDoc = (payload: {
  userId: number;
  actorId: number;
  docType: DocType;
  fileBase64: string;
  mimeType: string;
  fileName: string;
}) => post({ action: 'upload_doc', ...payload });

export const saveSbp = (payload: {
  userId: number;
  actorId: number;
  sbpPhone: string;
  sbpBank: string;
}) => post({ action: 'save_sbp', ...payload });

export const confirmSbp = (userId: number, actorId: number) =>
  post({ action: 'confirm_sbp', userId, actorId });

export const savePassport = (payload: {
  userId: number;
  actorId: number;
  verified: boolean;
  passportSeries?: string;
  passportNumber?: string;
  passportIssuedBy?: string;
  passportIssuedDate?: string;
  passportDepartmentCode?: string;
  birthDate?: string;
  registrationAddress?: string;
  snils?: string;
  inn?: string;
}) => post({ action: 'save_passport', ...payload });
