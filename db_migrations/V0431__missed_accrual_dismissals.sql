CREATE TABLE IF NOT EXISTS missed_accrual_dismissals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    stage VARCHAR(50) NOT NULL,
    dismissed_count INTEGER NOT NULL DEFAULT 0,
    dismissed_at TIMESTAMP NOT NULL DEFAULT now(),
    dismissed_by INTEGER NULL,
    UNIQUE (user_id, stage)
);

COMMENT ON TABLE missed_accrual_dismissals IS
 'Скрытые администратором предупреждения «работа без начисления». Хранит количество на момент скрытия: если у сотрудника на этом этапе появятся НОВЫЕ незакрытые заказы, предупреждение вернётся само.';
