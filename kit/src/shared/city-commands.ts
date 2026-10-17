// The city's own chat commands (server/city-services.ts answers them, server/requests.ts takes the song ones). Kept on
// their own, with nothing else, so a machine reads isCityCommand through the kit without the city's services.

export const COINS_COMMAND = /^!(coins|balance|bal)\b/i;
export const COLOR_COMMAND = /^!colou?rs?\b(.*)/i;
export const STATS_COMMAND = /^!(stats|career|me)\b/i;
export const FIREWORKS_COMMAND = /^!(fireworks|firework|fw)\b/i;
export const REQUEST_COMMAND = /^!(sr|songrequest|request)\b\s*(.*)$/i;
export const SKIP_COMMAND = /^!skip\b/i;

/** Whether a chat line is one of the city's own commands, which the machines leave to the city. */
export const isCityCommand = (text: string): boolean => {
  const t = text.trim();
  return COINS_COMMAND.test(t) || COLOR_COMMAND.test(t) || STATS_COMMAND.test(t) || FIREWORKS_COMMAND.test(t) || REQUEST_COMMAND.test(t) || SKIP_COMMAND.test(t);
};
