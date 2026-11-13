export const ids = {
  inspect: {
    delete: (itemId: number): string => `insp:del:${itemId}`,
    randomize: (mailboxId: number): string => `insp:rand:${mailboxId}`,
  },
};

export function parseCustomId(customId: string): { namespace: string; action: string; args: string[] } {
  const parts = customId.split(':');
  const namespace = parts[0] ?? '';
  const action = parts[1] ?? '';
  const args = parts.slice(2);
  return { namespace, action, args };
}
