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
