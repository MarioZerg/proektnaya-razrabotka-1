-- Закладка постраничной загрузки возвратов OZON.
--
-- Возвратов у площадки сотни, а функции отведено несколько секунд на ответ — за один
-- заход всё не выгрузить. Запоминаем, на какой записи остановились по каждому статусу,
-- и следующий запуск продолжает с этого места, а не начинает сначала. Без этого
-- загрузка бесконечно перечитывала первую страницу, и дальние возвраты (в том числе
-- уже забранные кладовщиком коробки) в систему так и не попадали.
CREATE TABLE IF NOT EXISTS marketplace_returns_cursor (
    marketplace TEXT NOT NULL,
    visual_status TEXT NOT NULL,
    last_id BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (marketplace, visual_status)
);
