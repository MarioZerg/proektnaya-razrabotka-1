-- Картинка подарка на карточке магазина. Одна анимация пузырьков не показывает,
-- ЧТО именно покупает сотрудник — фотография делает награду понятной с первого
-- взгляда.
ALTER TABLE variki_shop_items ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

UPDATE variki_shop_items
SET image_url = 'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/a97d04fb-7189-49c6-acdf-c2810057d096.jpg',
    description = 'Сеанс гидромассажа в спа-салоне. После покупки администратор пришлёт купон — покажите его в салоне.'
WHERE title = 'Сертификат на гидромассаж';
