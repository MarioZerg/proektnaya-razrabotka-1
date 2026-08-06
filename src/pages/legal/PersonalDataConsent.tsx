import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';

/** Согласие на обработку персональных данных — текст, с которым соглашается человек,
 * ставя галочку при подаче заявки на доступ. */
const PersonalDataConsent = () => {
  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="ArrowLeft" size={16} />
          На главную
        </Link>

        <div>
          <h1 className="text-2xl font-bold">
            Согласие на обработку персональных данных
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Система управления швейного производства «МЕГАТЮЛЬ»
          </p>
        </div>

        <div className="space-y-5 text-sm leading-relaxed">
          <p>
            Подавая заявку на доступ к Системе, я свободно, своей волей и в своём интересе
            даю согласие ИП Левкин А.С. (ИНН 760218194200, ОГРН 322774600341432, далее —
            Оператор) на обработку моих персональных данных на условиях, изложенных ниже.
          </p>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Перечень данных</h2>
            <p>
              Фамилия, имя, отчество; номер телефона; адрес электронной почты; должность,
              цех и смена; идентификатор учётной записи в мессенджере MAX; сведения о
              выполненной работе, отработанном времени и начисленной оплате труда; документы,
              подписанные мной в Системе, и сведения об их подписании.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Цели обработки</h2>
            <p>
              Предоставление доступа к Системе; ведение учёта работы и расчётов по оплате
              труда; оформление и подписание документов между мной и Оператором; исполнение
              обязанностей, возложенных на Оператора законодательством Российской Федерации.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Действия с данными</h2>
            <p>
              Сбор, запись, систематизация, накопление, хранение, уточнение (обновление,
              изменение), извлечение, использование, передача (предоставление, доступ),
              блокирование, удаление и уничтожение — как с использованием средств
              автоматизации, так и без них.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Срок действия и отзыв</h2>
            <p>
              Согласие действует в течение срока отношений с Оператором и срока хранения
              документов, установленного законодательством. Я вправе отозвать согласие,
              направив письменное обращение Оператору. Я уведомлён, что отзыв согласия влечёт
              прекращение моего доступа к Системе.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold">Подтверждение</h2>
            <p>
              Я подтверждаю, что указанные мной данные принадлежат мне лично, ознакомлен с{' '}
              <Link to="/privacy" className="underline underline-offset-2">
                Политикой конфиденциальности
              </Link>{' '}
              и принимаю её условия.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PersonalDataConsent;
