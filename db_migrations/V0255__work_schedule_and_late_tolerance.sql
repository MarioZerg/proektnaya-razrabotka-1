-- График работы и допустимое опоздание в профиле сотрудника.
--
-- Раньше время работы приходилось вводить каждому вручную, а новичкам его вообще
-- не проставляли — из-за этого опоздания считались от общей настройки цеха.
-- Теперь у сотрудника есть свой график, а у новых он подставляется сам.

-- Тип графика: 2/2 (сменный) или 5/2 (пятидневка).
ALTER TABLE t_p86119184_proektnaya_razrabotk.users
    ADD COLUMN IF NOT EXISTS work_schedule VARCHAR(10);

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.users.work_schedule IS
    '2/2 — сменный график 07:00-19:00, 5/2 — пятидневка 08:00-17:00';

-- Сколько минут опоздания прощается. Пришёл в пределах допуска — не опоздал.
ALTER TABLE t_p86119184_proektnaya_razrabotk.users
    ADD COLUMN IF NOT EXISTS late_tolerance_minutes INTEGER NOT NULL DEFAULT 15;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.users.late_tolerance_minutes IS
    'Допустимое опоздание в минутах. По умолчанию 15';

-- Всем действующим сотрудникам ставим сменный график 2/2 с 07:00 до 19:00.
-- Это основной режим цеха: швеи, закройщицы, упаковщицы работают именно так.
UPDATE t_p86119184_proektnaya_razrabotk.users
SET work_schedule = '2/2',
    shift_from = '07:00',
    shift_to = '19:00',
    updated_at = now()
WHERE role IN ('sewer', 'cutter', 'packer')
  AND work_schedule IS NULL;

-- Кладовщики, менеджеры и уборщицы работают по пятидневке 08:00-17:00.
UPDATE t_p86119184_proektnaya_razrabotk.users
SET work_schedule = '5/2',
    shift_from = COALESCE(shift_from, '08:00'),
    shift_to = COALESCE(shift_to, '17:00'),
    updated_at = now()
WHERE role IN ('storekeeper', 'senior_storekeeper', 'manager', 'cleaner')
  AND work_schedule IS NULL;
