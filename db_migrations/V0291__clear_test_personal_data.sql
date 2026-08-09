-- Убираем тестовые данные, которыми проверялась генерация договора: реальный
-- сотрудник свои реквизиты и паспорт ещё не заполнял.
UPDATE users
SET sbp_phone = NULL,
    sbp_bank = NULL,
    sbp_confirmed = false,
    sbp_confirmed_at = NULL,
    sbp_confirmed_by = NULL,
    passport_series = NULL,
    passport_number = NULL,
    passport_issued_by = NULL,
    passport_issued_date = NULL,
    passport_department_code = NULL,
    birth_date = NULL,
    registration_address = NULL,
    snils = NULL,
    inn = NULL,
    personal_data_verified = false,
    personal_data_verified_at = NULL,
    personal_data_verified_by = NULL
WHERE id = 3;
