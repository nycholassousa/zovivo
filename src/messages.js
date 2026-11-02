/**
 * What Zovivo says in the chat, in the language the super admin chose. Plain
 * text and a link: Zoia's chat shows `**` as it is typed.
 */

const TEXT = {
  en: { live: '🔴 {name} is live', liveWith: '🔴 {name} is live: {game}' },
  pt: { live: '🔴 {name} está ao vivo', liveWith: '🔴 {name} está ao vivo: {game}' },
  es: { live: '🔴 {name} está en directo', liveWith: '🔴 {name} está en directo: {game}' },
};

/**
 * The message for a stream.
 *
 * @param {string} language
 * @param {{ login: string, name: string, title: string, game: string }} stream
 */
export function announcement(language, { login, name, title, game }) {
  const text = TEXT[language] ?? TEXT.en;
  const headline = (game ? text.liveWith : text.live)
    .replace('{name}', () => name)
    .replace('{game}', () => game);
  return [headline, title, `https://www.twitch.tv/${login}`].filter(Boolean).join('\n');
}
