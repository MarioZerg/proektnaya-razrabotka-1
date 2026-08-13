import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import InstallAppButton from '@/components/InstallAppButton';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/roles';
import { fetchMaxBotUrl, enterRole, type UserRoleEntry } from '@/lib/authApi';
import OnlineNowBadge from '@/components/auth/OnlineNowBadge';
import RoleSelectScreen from '@/components/auth/RoleSelectScreen';
import PendingApprovalScreen from '@/components/auth/PendingApprovalScreen';

type Step =
  | 'start'
  | 'pendingApproval'
  | 'pickActiveRole';

const Index = () => {
  const navigate = useNavigate();
  const { login, user } = useAuth();

  // Ввод кода живёт на отдельной странице (/login/code) — сюда он не возвращается,
  // поэтому хранить шаг между перезагрузками больше не нужно.
  const [step, setStep] = useState<Step>('start');
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [pendingUser, setPendingUser] = useState<{
    id: number;
    name: string;
    phone: string | null;
    roles: UserRoleEntry[];
  } | null>(null);
  const [entering, setEntering] = useState(false);

  // Уже вошедшего сотрудника сразу уводим в систему.
  //
  // Зачем: на несуществующий адрес (404) человек попадает вместе с открытой сессией,
  // а экран 404 через 3 секунды уводит на главную. Главная — это страница входа, и
  // раньше она показывала форму «Войти через MAX», будто сессии нет: выглядело как
  // разлогин, приходилось заходить заново. Сессия при этом никуда не пропадала —
  // её просто не проверяли.
  useEffect(() => {
    if (user) navigate('/crm', { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    // Ссылка на бота — необязательная деталь: если сервер молчит, экран входа всё равно
    // должен открыться. Без перехвата ошибка всплывала наверх и оставляла страницу
    // в состоянии загрузки.
    fetchMaxBotUrl()
      .then(({ botUrl: url, loginToken }) => {
        setBotUrl(url);
        // Метку этой вкладки передаём странице ввода кода: по ней она заберёт
        // готовый код у бота, и человеку не придётся переписывать шесть цифр.
        if (loginToken) sessionStorage.setItem('maxLoginToken', loginToken);
      })
      .catch(() => setBotUrl(null));
  }, []);

  const handleOpenBot = () => {
    // Сначала переводим человека на страницу ввода кода и только потом открываем бота.
    //
    // Порядок важен: внутри приложения MAX переход в чат выгружает страницу сразу.
    // Раз ввод кода теперь живёт по собственному адресу (/login/code), возврат из
    // мессенджера — системной кнопкой «назад» или через историю — приводит ровно на
    // форму ввода, а не на начало входа. Код при этом остаётся действующим.
    navigate('/login/code');
    if (botUrl) {
      // В приложении MAX сайт уже открыт внутри мессенджера, и новая вкладка там не
      // создаётся — открываем бота в текущем окне. В обычном браузере оставляем
      // отдельную вкладку: страница ввода кода остаётся открытой рядом.
      const inMaxApp = /MAX/i.test(navigator.userAgent) || window.self !== window.top;
      if (inMaxApp) window.location.href = botUrl;
      else window.open(botUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const finishLogin = (data: {
    id: number;
    name: string;
    role: string;
    workshopId: number | null;
    workshopName: string | null;
    shiftNumber: number | null;
  }) => {
    login({
      id: data.id,
      name: data.name,
      role: data.role as Role,
      availableRoles: pendingUser
        ? pendingUser.roles.filter((r) => r.isApproved).map((r) => r.role)
        : [data.role as Role],
      workshopId: data.workshopId ?? null,
      workshopName: data.workshopName ?? null,
      shiftNumber: data.shiftNumber ?? null,
    });
    navigate('/crm');
  };

  const handlePickActiveRole = async (role: Role) => {
    if (!pendingUser) return;
    setEntering(true);
    setError('');
    try {
      const data = await enterRole(pendingUser.id, role);
      finishLogin(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setEntering(false);
    }
  };

  const handleBackToStart = () => {
    setStep('start');
    setError('');
    setPendingUser(null);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-6 py-12 sm:py-16">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.25]" />

      <div className="relative w-full max-w-[360px] animate-fade-in">
        <div className="mb-10 mt-2 flex flex-col items-center gap-4 text-center">
          {/* Круглый логотип со светящейся дугой, бегущей по часовой стрелке.
              Рисуем через SVG, а не CSS-градиентом: conic-gradient вместе с
              обрезкой по кругу не работал в мобильных браузерах — на телефоне
              вращение просто не показывалось. SVG-дуга с обводкой крутится
              одинаково и на телефоне, и на компьютере. */}
          <div className="relative h-36 w-36 animate-logo-zoom">
            <svg
              viewBox="0 0 100 100"
              className="absolute inset-0 h-full w-full animate-logo-spin"
              aria-hidden="true"
            >
              <defs>
                {/* Градиент вдоль дуги: от прозрачного к насыщенному — получается
                    ощущение бегущего по кругу светового сгустка. */}
                {/* Цвет задаём готовым значением, а не переменной темы: мобильные
                    браузеры (в частности Яндекс.Браузер) не подставляют CSS-переменные
                    внутрь SVG-градиента — дуга получалась прозрачной и казалось, что
                    анимации нет. Это цвет primary из темы. */}
                <linearGradient id="logoArc" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#424d38" stopOpacity="0" />
                  <stop offset="55%" stopColor="#424d38" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#424d38" stopOpacity="1" />
                </linearGradient>
              </defs>
              {/* Дуга примерно на 3/4 окружности: разрыв показывает начало и конец. */}
              <circle
                cx="50"
                cy="50"
                r="47"
                fill="none"
                stroke="url(#logoArc)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="210 85"
              />
            </svg>
            <img
              src="/assets/megatul-round-logo.png"
              alt="МЕГАТЮЛЬ"
              className="absolute inset-0 h-full w-full object-contain p-[6px]"
            />
          </div>
          <OnlineNowBadge />
        </div>

        {step === 'start' && (
          <div className="space-y-4">
            <Button
              type="button"
              onClick={handleOpenBot}
              disabled={!botUrl}
              className="relative h-12 w-full overflow-hidden rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {/* Блик пробегает по кнопке — подсказывает, что это основной способ входа. */}
              <span className="pointer-events-none absolute inset-0 -skew-x-12 animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
              <Icon name="MessageCircle" size={18} className="mr-2" />
              Войти через MAX
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Откроется бот МЕГАТЮЛЬ — поделитесь номером телефона, и бот пришлёт код для входа
            </p>

            {/* Вход в систему только через MAX. Отдельная заявка на доступ убрана:
                бот сам заводит нового человека по номеру телефона и присылает код,
                а должность он выбирает уже на сайте. Вторая дверь только путала —
                люди подавали заявку и ждали ответа вместо того, чтобы просто войти. */}

            {/* Установка на главный экран планшета/телефона. Кнопка появляется только
                когда установка возможна и приложение ещё не установлено. */}
            <InstallAppButton />

            {/* Реквизиты компании и юридические документы. */}
            <div className="space-y-0.5 pt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
              <p className="pb-1">
                <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
                  Политика конфиденциальности
                </Link>
                {' · '}
                <Link to="/consent" className="underline underline-offset-2 hover:text-foreground">
                  Обработка персональных данных
                </Link>
              </p>
              <p>Система управления швейного производства</p>
              <p>ИНН: 760218194200 · ОГРН: 322774600341432</p>
              <p>
                ИП Левкин А.С. ·{' '}
                <a href="tel:+79997863525" className="hover:text-foreground">
                  +7 999 786-35-25
                </a>
              </p>
            </div>

          </div>
        )}

        {step === 'pendingApproval' && pendingUser && (
          <PendingApprovalScreen roles={pendingUser.roles.map((r) => r.role)} onLogout={handleBackToStart} />
        )}

        {step === 'pickActiveRole' && pendingUser && (
          <>
            <RoleSelectScreen
              title={`Здравствуйте, ${pendingUser.name}!`}
              description="Выберите, в какой должности хотите работать сейчас"
              roles={pendingUser.roles.filter((r) => r.isApproved).map((r) => r.role)}
              disabled={entering}
              onSelect={handlePickActiveRole}
            />
            {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
};

export default Index;