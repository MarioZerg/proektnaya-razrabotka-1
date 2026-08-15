import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';

/** «1 рулон», «22 рулона», «5 рулонов» — иначе на экране висит «21 рулонов». */
const rollWord = (n: number) => {
  const last2 = n % 100;
  const last1 = n % 10;
  if (last2 >= 11 && last2 <= 14) return 'рулонов';
  if (last1 === 1) return 'рулон';
  if (last1 >= 2 && last1 <= 4) return 'рулона';
  return 'рулонов';
};

interface KioskRollScanPromptProps {
  loading: boolean;
  /** Сколько рулонов «своего» типа в смене — показываем под приглашением. */
  rollsCount: number;
  /** Номер отсканированного рулона, которого нет в смене. */
  notFound: string;
  onOpenList: () => void;
}

/** Главный экран — приглашение отсканировать рулон. Список рулонов открывается
 * отдельной кнопкой: он нужен редко (порван стикер, сканер не читает), а когда он
 * был главным экраном, закройщик по привычке тыкал в номера и ошибался рулоном. */
const KioskRollScanPrompt = ({
  loading,
  rollsCount,
  notFound,
  onOpenList,
}: KioskRollScanPromptProps) => (
  <div className="space-y-4">
    <Card className="border-2 border-dashed border-primary/40 shadow-none">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="rounded-full bg-primary/10 p-6">
          <Icon name="ScanLine" size={64} className="text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold">Отсканируйте рулон</p>
          <p className="mt-1 text-lg text-muted-foreground">
            Поднесите сканер к стикеру на рулоне
          </p>
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="Loader2" size={20} className="animate-spin" />
            Загружаю рулоны смены…
          </div>
        )}
        {!loading && (
          <p className="text-base text-muted-foreground">
            В вашей смене {rollsCount} {rollWord(rollsCount)}
          </p>
        )}
      </CardContent>
    </Card>

    {/* Промах сканера показываем крупно: номер видно с расстояния вытянутой руки. */}
    {notFound && (
      <Card className="border-destructive bg-destructive/5 shadow-none">
        <CardContent className="flex items-start gap-3 py-4">
          <Icon name="TriangleAlert" size={24} className="mt-0.5 shrink-0 text-destructive" />
          <div>
            <p className="font-bold text-destructive">Рулон #{notFound} не найден</p>
            <p className="text-base text-muted-foreground">
              Его нет в вашей смене. Проверьте стикер или назовите номер кладовщику
            </p>
          </div>
        </CardContent>
      </Card>
    )}

    <Button
      variant="outline"
      size="lg"
      className="h-14 w-full text-base"
      onClick={onOpenList}
    >
      <Icon name="List" size={22} className="mr-2" />
      Стикер не читается — выбрать из списка
    </Button>
  </div>
);

export default KioskRollScanPrompt;
