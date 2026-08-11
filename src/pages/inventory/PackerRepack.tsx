import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import KioskRepackScreen from '@/components/crm/kiosk/KioskRepackScreen';
import { useAuth } from '@/context/AuthContext';

/**
 * Осмотр возвратов упаковщицей — та же работа, что на планшете в цехе, но с компьютера.
 *
 * Кладовщик передал вещи в цех, и упаковщица видит их здесь списком: что за товар и
 * почему покупатель отказался. По каждой вещи два решения:
 *   «Переупаковано» — вещь годная: печатается стикер хранения, она уходит в «Осмотрено»
 *     и ждёт, когда кладовщик заберёт её на полку;
 *   «Брак — списать» — при вскрытии нашёлся дефект: вещь уходит на утилизацию с причиной,
 *     на полку она не попадёт.
 *
 * Экран намеренно тот же, что в киоске: одна логика, одни кнопки, одна печать стикера —
 * упаковщице не нужно переучиваться при переходе с планшета на компьютер.
 */
const PackerRepack = () => {
  const { user } = useAuth();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Осмотр возвратов</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Вещи, которые кладовщик передал в цех на проверку
          </p>
        </div>

        {user ? (
          <KioskRepackScreen actorId={user.id} actorName={user.name} />
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default PackerRepack;
