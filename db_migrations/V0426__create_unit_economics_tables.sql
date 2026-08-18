-- ЮНИТ-ЭКОНОМИКА МАРКЕТПЛЕЙСОВ
--
-- Себестоимость отвечает на вопрос «во сколько нам обходится вещь».
-- Юнит-экономика — на вопрос «сколько мы на ней зарабатываем после того,
-- как площадка заберёт своё». Это разные расчёты: в себестоимости комиссия
-- сидит внутри цифры, а здесь она считается ОТ ЦЕНЫ ПРОДАЖИ, как в жизни.

-- Цены и скидки по каждому товару на каждой площадке.
-- Тянутся из API кабинетов: у одного товара цена на Ozon, WB и Яндексе разная,
-- и скидки площадка меняет сама — вручную это не отследить.
CREATE TABLE IF NOT EXISTS marketplace_prices (
  id SERIAL PRIMARY KEY,
  marketplace_item_id INTEGER NOT NULL REFERENCES marketplace_items(id),
  -- 'ozon' | 'wildberries' | 'yandex_market'
  marketplace_code VARCHAR(30) NOT NULL,
  -- Цена до скидок (зачёркнутая на витрине).
  price_before_discount NUMERIC(12,2),
  -- Цена, которую реально платит покупатель (после скидки продавца).
  price NUMERIC(12,2),
  -- Цена с учётом скидки САМОЙ площадки за свой счёт (СПП у WB, Ozon-скидка).
  -- Продавцу площадка компенсирует разницу, поэтому в расчёт берётся price.
  price_with_marketplace_discount NUMERIC(12,2),
  discount_percent NUMERIC(6,2),
  -- Комиссия площадки по КАТЕГОРИИ товара: у FBO и FBS она разная.
  commission_fbo_percent NUMERIC(6,2),
  commission_fbs_percent NUMERIC(6,2),
  -- Объём товара для расчёта логистики (л) и вес (кг).
  volume_liters NUMERIC(10,3),
  weight_kg NUMERIC(10,3),
  -- Откуда данные: 'api' — из кабинета, 'manual' — правил менеджер.
  source VARCHAR(20) NOT NULL DEFAULT 'api',
  synced_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (marketplace_item_id, marketplace_code)
);

CREATE INDEX IF NOT EXISTS idx_mp_prices_code ON marketplace_prices (marketplace_code);

-- Тарифы площадки: логистика, хранение, обратная логистика, эквайринг.
-- Одна строка на площадку — тарифы общие для всех товаров, а комиссия
-- по категории лежит в marketplace_prices, потому что она у товаров разная.
CREATE TABLE IF NOT EXISTS marketplace_tariffs (
  id SERIAL PRIMARY KEY,
  marketplace_code VARCHAR(30) NOT NULL UNIQUE,
  -- Логистика до покупателя, ₽ за единицу.
  logistics_fbo NUMERIC(12,2) NOT NULL DEFAULT 0,
  logistics_fbs NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Обратная логистика — платим за КАЖДЫЙ возврат/отказ, даже если товар вернулся целым.
  return_logistics NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Хранение на складе площадки за единицу в месяц (только FBO).
  storage_per_month NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Приёмка поставки на складе площадки, руб за единицу (FBO).
  acceptance_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Эквайринг: процент за приём платежа.
  acquiring_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  -- Продвижение/реклама, % от цены — менеджер задаёт сам.
  promo_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
  -- Средний срок хранения на FBO, мес. Нужен, чтобы размазать хранение на единицу.
  storage_months NUMERIC(6,2) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by INTEGER
);

-- Общие параметры юнит-экономики: налог и постоянные расходы.
CREATE TABLE IF NOT EXISTS unit_economics_settings (
  id SERIAL PRIMARY KEY,
  -- Налог считается ОТ ВЫРУЧКИ (УСН «доходы»), а не от себестоимости.
  tax_percent NUMERIC(6,2) NOT NULL DEFAULT 6,
  -- Постоянные расходы компании в месяц — для точки безубыточности.
  fixed_costs_month NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by INTEGER
);

INSERT INTO unit_economics_settings (tax_percent, fixed_costs_month)
SELECT 6, 0
WHERE NOT EXISTS (SELECT 1 FROM unit_economics_settings);

-- Заготовки тарифов на три подключённые площадки.
INSERT INTO marketplace_tariffs (marketplace_code)
SELECT c FROM (VALUES ('ozon'), ('wildberries'), ('yandex_market')) AS t(c)
WHERE NOT EXISTS (
  SELECT 1 FROM marketplace_tariffs mt WHERE mt.marketplace_code = t.c
);