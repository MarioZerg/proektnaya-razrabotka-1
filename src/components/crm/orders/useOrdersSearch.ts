import { useEffect, useState } from 'react';
import { searchOrders, type Order } from '@/lib/ordersApi';

// ПОИСК ПО НОМЕРУ ЗАКАЗА.
//
// Просеивать загруженный список бесполезно: сервер отдаёт только свежую часть
// истории (примерно месяц) и свежие отмены — дальше ответ не помещается в
// потолок платформы. Заказа прошлого квартала в списке физически НЕТ, и на
// вопрос «где мой заказ» ответить было нечем.
//
// Поэтому поиск уходит на сервер: он ищет прямо в базе и находит заказ любой
// давности. Результат показываем вместо списка, не трогая сам список, — стоит
// очистить поле, и конвейер возвращается на экран без перезагрузки.
export const useOrdersSearch = () => {
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Order[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  /** По какому запросу пришли searchResults: по скану открываем только свежий ответ. */
  const [resultsFor, setResultsFor] = useState<string | null>(null);

  // Ищем не на каждую букву: пока человек печатает номер, запрос ушёл бы
  // десяток раз подряд, а нужен только последний. Ждём паузу в наборе.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    let cancelled = false;
    const t = setTimeout(() => {
      searchOrders(q)
        .then((found) => {
          // Ответ на устаревший запрос игнорируем: иначе медленный ответ по
          // старому куску номера перетёр бы результат свежего.
          if (!cancelled) {
            setSearchError(null);
            setSearchResults(found);
            setResultsFor(q);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setSearchError(e instanceof Error ? e.message : 'Не удалось найти заказ');
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, searchRetry]);

  return {
    search,
    setSearch,
    searchResults,
    setSearchResults,
    searching,
    searchError,
    setSearchRetry,
    resultsFor,
  };
};

export default useOrdersSearch;
