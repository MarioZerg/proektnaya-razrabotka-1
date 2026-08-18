import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface KioskNumPadProps {
  /** Текущее значение поля. */
  value: string;
  onChange: (next: string) => void;
  /** Разрешить дробные числа (метраж). Для штук — false. */
  decimal?: boolean;
  /** Максимум символов, чтобы в поле не улетала бесконечная строка. */
  maxLength?: number;
}

/**
 * Цифровая клавиатура для сенсорного киоска.
 *
 * В цехе нет клавиатуры и мыши — работают пальцами по экрану. Обычное поле ввода
 * там бесполезно: системная клавиатура либо не всплывает, либо закрывает половину
 * экрана. Поэтому любые числа (метраж, количество, недостача) набираются крупными
 * кнопками прямо в интерфейсе.
 *
 * Кнопки высотой 80px — под палец в перчатке, с запасом от случайных промахов.
 */
const KioskNumPad = ({ value, onChange, decimal = true, maxLength = 6 }: KioskNumPadProps) => {
  const pressDigit = (d: string) => onChange((value + d).slice(0, maxLength));
  // Точка только одна и только если число дробное. Пустое поле начинаем с «0.»,
  // иначе получилось бы «.5» — такое значение не читается с расстояния.
  const pressDot = () => {
    if (!decimal || value.includes('.')) return;
    onChange(value ? `${value}.` : '0.');
  };
  const pressBack = () => onChange(value.slice(0, -1));

  return (
    <div className="grid grid-cols-3 gap-2">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <Button
          key={d}
          type="button"
          variant="outline"
          className="h-20 text-3xl font-semibold"
          onClick={() => pressDigit(d)}
        >
          {d}
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-20 text-3xl font-semibold"
        onClick={pressDot}
        disabled={!decimal}
      >
        ,
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-20 text-3xl font-semibold"
        onClick={() => pressDigit('0')}
      >
        0
      </Button>
      <Button type="button" variant="outline" className="h-20" onClick={pressBack}>
        <Icon name="Delete" size={30} />
      </Button>
    </div>
  );
};

export default KioskNumPad;
