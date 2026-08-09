import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

/** Событие браузера, которым он предлагает установку приложения. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Кнопка «Установить приложение».
 *
 * Система ставится как обычное приложение прямо из браузера — без скачивания файлов
 * и разрешений на установку из неизвестных источников. Обновляется тоже сама, отдельно
 * раздавать новые версии сотрудникам больше не нужно.
 *
 * Android и настольный Chrome умеют ставить в одно нажатие: браузер заранее присылает
 * событие, мы его придерживаем и показываем кнопку. На iPhone такого события нет —
 * там установка только вручную через «Поделиться», поэтому показываем инструкцию.
 *
 * Если приложение уже установлено и открыто с ярлыка, кнопку не показываем совсем.
 */
const InstallAppButton = () => {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  // Открыто с ярлыка — предлагать установку незачем.
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      // iOS помечает запуск с домашнего экрана своим способом.
      (window.navigator as { standalone?: boolean }).standalone === true);

  const isIos =
    typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Гасим стандартную плашку браузера, чтобы показать свою кнопку в нужном месте.
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    // Событие одноразовое: второй раз показать то же окно браузер не даст.
    setPromptEvent(null);
  };

  if (isStandalone || installed) return null;

  // iPhone: браузер установку сам не предложит — объясняем, как поставить руками.
  if (isIos) {
    return (
      <div className="space-y-1.5">
        <Button
          variant="outline"
          className="h-12 w-full rounded-sm"
          onClick={() => setShowIosHint((v) => !v)}
        >
          <Icon name="Smartphone" size={18} className="mr-2" />
          Установить приложение
        </Button>
        {showIosHint && (
          <p className="text-center text-xs text-muted-foreground">
            Нажмите «Поделиться» внизу браузера, затем «На экран "Домой"» — приложение
            появится на главном экране
          </p>
        )}
      </div>
    );
  }

  // Браузер ещё не предложил установку (или она недоступна) — кнопку не рисуем,
  // чтобы не обещать того, что не сработает.
  if (!promptEvent) return null;

  return (
    <div className="space-y-1.5">
      <Button variant="outline" className="h-12 w-full rounded-sm" onClick={handleInstall}>
        <Icon name="Download" size={18} className="mr-2" />
        Установить приложение
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Появится на экране как обычное приложение и будет обновляться само
      </p>
    </div>
  );
};

export default InstallAppButton;
