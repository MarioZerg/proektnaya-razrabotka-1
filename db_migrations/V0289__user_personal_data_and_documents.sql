-- Персональные данные сотрудника для договора и реквизиты СБП для выплат.
-- Хранятся в users, потому что относятся к человеку, а не к конкретному договору:
-- договоров у сотрудника может быть несколько, паспорт один.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS passport_series VARCHAR(10),
  ADD COLUMN IF NOT EXISTS passport_number VARCHAR(10),
  ADD COLUMN IF NOT EXISTS passport_issued_by TEXT,
  ADD COLUMN IF NOT EXISTS passport_issued_date DATE,
  ADD COLUMN IF NOT EXISTS passport_department_code VARCHAR(15),
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS registration_address TEXT,
  ADD COLUMN IF NOT EXISTS snils VARCHAR(20),
  ADD COLUMN IF NOT EXISTS inn VARCHAR(20);

-- Реквизиты для перевода по СБП. Сотрудник вводит сам, админ подтверждает кнопкой:
-- пока не подтверждено, договор отправить нельзя — иначе деньги уйдут на чужой номер.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sbp_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS sbp_bank VARCHAR(120),
  ADD COLUMN IF NOT EXISTS sbp_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sbp_confirmed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sbp_confirmed_by INTEGER REFERENCES users(id);

-- Отметка, что администратор сверил паспортные данные со сканом.
-- Без неё договор не сформировать: опечатка в номере паспорта делает договор ничтожным.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS personal_data_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS personal_data_verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS personal_data_verified_by INTEGER REFERENCES users(id);

-- Сканы документов. Отдельной таблицей, а не полями в users: разворотов паспорта
-- несколько, качество бывает плохим и скан приходится перезагружать.
CREATE TABLE IF NOT EXISTS user_documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- passport_main — разворот с фото, passport_registration — прописка, snils — СНИЛС
  doc_type VARCHAR(40) NOT NULL,
  file_url TEXT NOT NULL,
  file_name VARCHAR(300),
  mime_type VARCHAR(100),
  file_size INTEGER,
  uploaded_at TIMESTAMP NOT NULL DEFAULT now(),
  uploaded_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_documents_user ON user_documents(user_id);

-- На каждый тип документа держим только последний загруженный файл: если сотрудник
-- прислал размытое фото и перезагрузил, старое должно замениться, а не копиться.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_documents_user_type
  ON user_documents(user_id, doc_type);
