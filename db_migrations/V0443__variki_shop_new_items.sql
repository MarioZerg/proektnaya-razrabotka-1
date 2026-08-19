-- Новые подарки в магазине вариков. Цены пока не заданы админом — ставим ориентир
-- относительно гидромассажа (8000): развлечения дешевле, медицинские услуги дороже.
-- Админ поменяет их во вкладке управления.
INSERT INTO variki_shop_items (title, description, price, animation, icon, image_url, stock_limit, sort_order)
SELECT * FROM (VALUES
  ('Поход в кинотеатр',
   'Билет в кино на любой фильм по вашему выбору.',
   2000, 'none', 'Clapperboard',
   'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/c8ac1968-ace2-49fc-8948-bc563d1885fa.jpg',
   10, 2),
  ('Гигиеническая чистка полости рта',
   'Профессиональная чистка зубов в стоматологической клинике доктора Шакирзянова.',
   6000, 'none', 'Smile',
   'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/45377b72-86dd-4425-97fc-6d95704fe83e.jpg',
   5, 3),
  ('Массаж в центре доктора Бубновского',
   'Сеанс лечебного массажа в центре доктора Бубновского.',
   6000, 'none', 'HandHeart',
   'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/c0075c06-edb9-4656-8f66-c0f3d1a58d12.jpg',
   5, 4),
  ('Термоленд — городской курорт на море',
   'Посещение термального курорта «Термоленд». Сеанс 2 часа.',
   5000, 'spa', 'Waves',
   'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/cc26878a-07c7-48e3-8326-2359afdc7f3f.jpg',
   5, 5),
  ('Аквапарк Ярославль',
   'Посещение аквапарка в Ярославле. 2 часа катания с горок.',
   4000, 'spa', 'Waves',
   'https://cdn.poehali.dev/projects/e7a17910-1e21-4649-8728-8d926705d44e/files/a81ed998-99b6-4889-806c-67a1ec3c85bd.jpg',
   5, 6)
) AS v(title, description, price, animation, icon, image_url, stock_limit, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM variki_shop_items i WHERE i.title = v.title);
