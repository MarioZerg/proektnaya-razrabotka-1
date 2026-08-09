-- Картинка штрихкода от самого маркетплейса.
--
-- OZON рисует штрихкод выдачи возвратов на своей стороне и отдаёт готовым изображением.
-- Храним именно его, а не перерисовываем сами: на пункте выдачи сканируют ровно тот код,
-- который выпустил маркетплейс, без риска ошибки в формате.
ALTER TABLE t_p86119184_proektnaya_razrabotk.return_pickup_codes
    ADD COLUMN IF NOT EXISTS code_image TEXT;

COMMENT ON COLUMN t_p86119184_proektnaya_razrabotk.return_pickup_codes.code_image IS
    'Готовая картинка штрихкода от маркетплейса в base64 (PNG)';
