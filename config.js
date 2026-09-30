// Адрес посредника в Yandex Cloud (Cloud Function), через который сайт работает с Диском.
export const FUNCTION_URL = 'https://functions.yandexcloud.net/d4eotnn5qmurkd5kle8k';

// Песни, изменённые за это число дней, помечаются как «новое».
export const NEW_DAYS = 14;
// Всё, что загружено до этой даты (первый перенос из Notion), новым не считается.
export const NEW_SINCE = '2026-10-01';
