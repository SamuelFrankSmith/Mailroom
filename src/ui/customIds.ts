export const ids = {
  publish: {
    confirmPinned: (mailboxId: number): string => `pub:confirm-pinned:${mailboxId}`,
    confirmItem:   (mailboxId: number, itemId: number): string => `pub:confirm-item:${mailboxId}:${itemId}`,
    cancel:        (mailboxId: number): string => `pub:cancel:${mailboxId}`,
  },
  inspect: {
    delete:    (itemId: number,    page: number): string => `insp:del:${itemId}:${page}`,
    randomize: (mailboxId: number, page: number): string => `insp:rand:${mailboxId}:${page}`,
    prev:      (mailboxId: number, page: number): string => `insp:prev:${mailboxId}:${page}`,
    next:      (mailboxId: number, page: number): string => `insp:next:${mailboxId}:${page}`,
    pageLabel:     (page: number, totalPages: number): string => `insp:_:${page}:${totalPages}`,
    delYes:        (itemId: number,    page: number): string => `insp:del-yes:${itemId}:${page}`,
    delNo:         (itemId: number,    page: number): string => `insp:del-no:${itemId}:${page}`,
    editFreq:      (mailboxId: number, page: number): string => `insp:edit-freq:${mailboxId}:${page}`,
    editFreqModal: (mailboxId: number, page: number): string => `insp:edit-freq-modal:${mailboxId}:${page}`,
    confirmFreq:   (mailboxId: number, page: number, hh: string, mm: string, freq: string): string =>
                     `insp:confirm-freq:${mailboxId}:${page}:${hh}:${mm}:${freq}`,
    cancelFreq:    (mailboxId: number, page: number): string => `insp:cancel-freq:${mailboxId}:${page}`,
  },
};

export function parseCustomId(customId: string): { namespace: string; action: string; args: string[] } {
  const parts = customId.split(':');
  const namespace = parts[0] ?? '';
  const action = parts[1] ?? '';
  const args = parts.slice(2);
  return { namespace, action, args };
}
