import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import NotFound from "./NotFound";

/**
 * Обёртка над страницей 404: показывает стандартный экран NotFound и через 3 секунды
 * возвращает пользователя назад — на ту страницу, с которой он перешёл на несуществующий
 * адрес. Если истории переходов нет (прямой заход по ссылке) — уводит на главную.
 */
const NotFoundRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const canGoBack = window.history.length > 1;
    const timer = setTimeout(() => {
      if (canGoBack) navigate(-1);
      else navigate("/");
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return <NotFound />;
};

export default NotFoundRedirect;
