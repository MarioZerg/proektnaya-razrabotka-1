-- Контакты организации, которая оказывает услугу по сертификату.
--
-- Без них сотрудник с сертификатом на руках не знает, куда ехать и куда звонить
-- записываться: приходилось искать организацию в интернете или спрашивать админа.
-- Теперь адрес и телефон видны прямо в карточке подарка и в купленных.
ALTER TABLE variki_shop_items ADD COLUMN IF NOT EXISTS org_address VARCHAR(400) NULL;
ALTER TABLE variki_shop_items ADD COLUMN IF NOT EXISTS org_phone VARCHAR(50) NULL;

COMMENT ON COLUMN variki_shop_items.org_address IS
 'Адрес организации, где предъявляют сертификат.';
COMMENT ON COLUMN variki_shop_items.org_phone IS
 'Телефон организации для записи на услугу.';
