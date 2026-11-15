export const ids = {
  inspect: {
    delete:    (itemId: number,    page: number): string => `insp:del:${itemId}:${page}`,
    randomize: (mailboxId: number, page: number): string => `insp:rand:${mailboxId}:${page}`,
    prev:      (mailboxId: number, page: number): string => `insp:prev:${mailboxId}:${page}`,
    next:      (mailboxId: number, page: number): string => `insp:next:${mailboxId}:${page}`,
    pageLabel: (page: number, totalPages: number): string => `insp:_:${page}:${totalPages}`,
  },
};

export function parseCustomId(customId: string): { namespace: string; action: string; args: string[] } {
  const parts = customId.split(':');
  const namespace = parts[0] ?? '';
  const action = parts[1] ?? '';
  const args = parts.slice(2);
  return { namespace, action, args };
}
