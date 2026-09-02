-- Реквизиты грузоотправителя для ЭТрН берём из уже заполненных данных компании.
--
-- Заводить их отдельно значило бы держать те же ИНН и адрес в двух местах: рано или
-- поздно они разойдутся, и накладная уедет со старым адресом. Заполняем один раз
-- из company_*, дальше менеджер правит при необходимости прямо в карточке.
UPDATE system_settings SET value = (
    SELECT value FROM system_settings WHERE key = 'company_name'
) WHERE key = 'etrn_shipper_name' AND (value IS NULL OR value = '');

UPDATE system_settings SET value = (
    SELECT value FROM system_settings WHERE key = 'company_inn'
) WHERE key = 'etrn_shipper_inn' AND (value IS NULL OR value = '');

UPDATE system_settings SET value = (
    SELECT value FROM system_settings WHERE key = 'company_address'
) WHERE key = 'etrn_shipper_address' AND (value IS NULL OR value = '');

-- Адрес погрузки по умолчанию — наш склад, он же адрес компании.
UPDATE system_settings SET value = (
    SELECT value FROM system_settings WHERE key = 'company_address'
) WHERE key = 'etrn_pickup_address' AND (value IS NULL OR value = '');