/** Сообщение пользователю при проблемах с AITUNNEL (бюджет, ключ, доступ). */
export const TUNNEL_ADMIN_MSG =
  'Агент не работает обратитесь к Администратору - Нужна проверка Тунеля!';

/** Прячет технические ошибки ключа/бюджета сервиса ИИ. */
export const friendlyAgentError = (raw?: string | null): string => {
  const text = (raw || '').trim();
  if (!text) return TUNNEL_ADMIN_MSG;
  const low = text.toLowerCase();
  if (
    /402|бюджет|aitunnel|превышен|не разрешена|разрешает только|разреш[её]нн|megabux|megamag|не настроен ключ|ключ доступа|payment required|insufficient|quota|сервис ии ответил ошибкой/.test(
      low,
    )
  ) {
    return TUNNEL_ADMIN_MSG;
  }
  return text;
};
