import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import NotFound from "./NotFound";

/**
 * Обёртка над страницей 404: показывает экран NotFound и через 3 секунды уводит
 * пользователя оттуда.
 *
 * Куда возвращать — зависит от того, вошёл ли человек. Вошедшего сотрудника уводим
 * в систему (/crm), а не на главную: главная — это страница входа, и попадание на
 * неё выглядело как вылет из учётной записи, хотя сессия оставалась активной.
 */
const NotFoundRedirect = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  /**
   * Запрещаем поисковикам индексировать несуществующие страницы.
   *
   * Приложение отдаёт index.html на любой адрес, поэтому сервер отвечает 200 даже
   * на выдуманную ссылку — по одному коду ответа робот не поймёт, что страницы нет.
   * Мета-тег читают и Яндекс, и Google, так что мусорные адреса в индекс не попадут.
   * При уходе со страницы тег убираем, иначе он останется висеть на обычных разделах.
   */
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  useEffect(() => {
    const canGoBack = window.history.length > 1;
    const timer = setTimeout(() => {
      if (canGoBack) navigate(-1);
      else navigate(user ? "/crm" : "/", { replace: true });
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigate, user]);

  return <NotFound />;
};

export default NotFoundRedirect;