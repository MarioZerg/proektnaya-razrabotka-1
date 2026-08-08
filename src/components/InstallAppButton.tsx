import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

/** Событие Android/Chrome «страницу можно установить как приложение». */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Кнопка «Установить приложение».
 *
 * Браузер прячет установку глубоко в меню, и сотруднику это не объяснить. Здесь —
 * обычная кнопка: нажал, подтвердил, на экране появилась иконка «МЕГАТЮЛЬ».
 *
 * Кнопка показывается только когда установка реально возможна: если приложение уже
 * стоит или браузер её не поддерживает (например, iPhone), кнопки не будет — вместо
 * неё на iPhone показываем короткую подсказку.
 */
const InstallAppButton = () => {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Приложение уже открыто как приложение — предлагать установку незачем.
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }

    const onPrompt = (e: Event) => {
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
    await promptEvent.userChoice;
    setPromptEvent(null);
  };

  if (installed || !promptEvent) return null;

  return (
    <Button variant="outline" className="w-full" onClick={handleInstall}>
      <Icon name="Download" size={16} className="mr-2" />
      Установить приложение
    </Button>
  );
};

export default InstallAppButton;
