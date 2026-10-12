export interface RadioStation {
  id: string;
  name: string;
  city: string;
  /** Короткий знак на логотипе. */
  mark: string;
  color: string;
  stream: string;
}

/** Волны для цехового телевизора. Звук играет из его колонок. */
export const RADIO_STATIONS: RadioStation[] = [
  { id: 'europaplus', name: 'Европа Плюс', city: 'Москва', mark: 'Е+', color: '#1d4ed8', stream: 'https://ep256.hostingradio.ru:8052/europaplus256.mp3' },
  { id: 'dorozhnoe', name: 'Дорожное радио', city: 'Москва', mark: 'ДР', color: '#f59e0b', stream: 'https://dorognoe.hostingradio.ru/radio' },
  { id: 'rusradio', name: 'Русское радио', city: 'Москва', mark: 'РР', color: '#dc2626', stream: 'https://rusradio.hostingradio.ru/rusradio96.aacp' },
  { id: 'retro', name: 'Ретро FM', city: 'Москва', mark: 'RF', color: '#7c3aed', stream: 'https://retro.hostingradio.ru/retro320.mp3' },
  { id: 'avtoradio', name: 'Авторадио', city: 'Москва', mark: 'АР', color: '#ea580c', stream: 'https://pub0202.101.ru:8443/stream/air/aac/64/100' },
  { id: 'record', name: 'Радио Рекорд', city: 'Санкт-Петербург', mark: 'RR', color: '#0891b2', stream: 'https://radiorecord.hostingradio.ru/rr_main96.aacp' },
  { id: 'dfm', name: 'DFM', city: 'Москва', mark: 'DF', color: '#db2777', stream: 'https://dfm.hostingradio.ru/dfm96.aacp' },
  { id: 'hitfm', name: 'Хит FM', city: 'Москва', mark: 'ХИ', color: '#e11d48', stream: 'https://hitfm.hostingradio.ru/hitfm96.aacp' },
  { id: 'montecarlo', name: 'Монте-Карло', city: 'Москва', mark: 'MC', color: '#0f766e', stream: 'https://montecarlo.hostingradio.ru/montecarlo96.aacp' },
  { id: 'nashe', name: 'Наше радио', city: 'Москва', mark: 'НР', color: '#b45309', stream: 'https://nashe1.hostingradio.ru/nashe-128.mp3' },
  { id: 'chanson', name: 'Радио Шансон', city: 'Москва', mark: 'ШН', color: '#1e3a8a', stream: 'https://chanson.hostingradio.ru/chanson128.mp3' },
  { id: 'energy', name: 'Energy', city: 'Москва', mark: 'EN', color: '#65a30d', stream: 'https://pub0302.101.ru:8443/stream/air/aac/64/99' },
  { id: 'love', name: 'Love Radio', city: 'Москва', mark: 'LV', color: '#be123c', stream: 'https://pub0101.101.ru:8443/stream/air/aac/64/101' },
  { id: 'humor', name: 'Юмор FM', city: 'Москва', mark: 'ЮФ', color: '#ca8a04', stream: 'https://pub0302.101.ru:8443/stream/air/aac/64/102' },
  { id: 'relax', name: 'Relax FM', city: 'Москва', mark: 'RX', color: '#0369a1', stream: 'https://pub0101.101.ru:8443/stream/air/aac/64/200' },
  { id: 'mayak', name: 'Радио Маяк', city: 'Москва', mark: 'МЯ', color: '#b91c1c', stream: 'https://icecast-vgtrk.cdnvideo.ru/mayakfm_mp3_192kbps' },
  { id: 'vestifm', name: 'Вести FM', city: 'Москва', mark: 'ВФ', color: '#1d4ed8', stream: 'https://icecast-vgtrk.cdnvideo.ru/vestifm_mp3_192kbps' },
  { id: 'business', name: 'Business FM', city: 'Москва', mark: 'BF', color: '#334155', stream: 'https://bfm.hostingradio.ru:8004/fm' },
  { id: 'radio7', name: 'Радио 7', city: 'Москва', mark: 'Р7', color: '#c2410c', stream: 'https://radio7.hostingradio.ru:8040/radio7128.mp3' },
  { id: 'novoe', name: 'Новое радио', city: 'Москва', mark: 'НОВ', color: '#0e7490', stream: 'https://stream.newradio.ru/novoe96.aacp' },
  { id: 'jazz', name: 'Радио Jazz', city: 'Москва', mark: 'JZ', color: '#6d28d9', stream: 'https://nashe1.hostingradio.ru/jazz-128.mp3' },
  { id: 'kids', name: 'Детское радио', city: 'Москва', mark: 'ДЕ', color: '#16a34a', stream: 'https://pub0101.101.ru:8443/stream/air/aac/64/103' },
];

export const RADIO_IDS = new Set(RADIO_STATIONS.map((station) => station.id));

export const radioById = (id: string | null | undefined) =>
  RADIO_STATIONS.find((station) => station.id === id) || null;
