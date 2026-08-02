-- Смена как отдельная сущность: у каждого цеха есть реальные строки смен (не просто число
-- shifts_count), каждая смена может быть индивидуально активна/неактивна. Уникальность по
-- (workshop_id, shift_number) — номер смены внутри цеха, как и раньше использовался в users/rolls.
CREATE TABLE shifts (
    id SERIAL PRIMARY KEY,
    workshop_id INTEGER NOT NULL REFERENCES workshops(id),
    shift_number INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE(workshop_id, shift_number)
);

-- Переносим уже существующие "виртуальные" смены (workshops.shifts_count + shift_names)
-- в реальные строки, чтобы не потерять текущие данные и нумерацию смен.
INSERT INTO shifts (workshop_id, shift_number, name, is_active)
SELECT w.id, gs.n,
    COALESCE(NULLIF(w.shift_names->>(gs.n - 1), ''), 'Смена № ' || gs.n),
    true
FROM workshops w, generate_series(1, GREATEST(w.shifts_count, 1)) AS gs(n);

-- Календарь смен: полностью ручная разметка ВЫХОДНЫХ дней по дате для конкретной смены
-- конкретного цеха. Наличие строки = выходной день (смена не работает). Отсутствие строки =
-- обычный рабочий день. Для Цеха №2 (график 5/2) админ вручную проставляет СБ/ВС как выходные.
CREATE TABLE shift_calendar (
    id SERIAL PRIMARY KEY,
    workshop_id INTEGER NOT NULL REFERENCES workshops(id),
    shift_number INTEGER NOT NULL,
    calendar_date DATE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    created_by INTEGER NULL REFERENCES users(id),
    UNIQUE(workshop_id, shift_number, calendar_date)
);
CREATE INDEX idx_shift_calendar_date ON shift_calendar(calendar_date);

-- Гостевой режим сотрудника: если true — сотрудник НЕ привязан жёстко к своей штатной
-- смене/цеху (users.workshop/shift_number) и при открытии смены сам выбирает, в какой
-- цех/смену зайти сегодня — работает с материалами именно той смены, куда зашёл.
-- Штатные workshop/shift_number в профиле при этом не меняются (остаются "домашней" сменой).
ALTER TABLE users ADD COLUMN shift_free BOOLEAN NOT NULL DEFAULT false;
