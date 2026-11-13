export interface Mailbox {
  id: number;
  userId: string;
  channelId: string;
  guildId: string;
  frequency: string;    // e.g. '3d', '2w', '1h'
  postTime: string;     // 'HH:mm' (UTC)
  randomize: boolean;
  nextPostAt: string;   // ISO 8601 UTC
}

export interface Item {
  id: number;
  mailboxId: number;
  type: 'text' | 'image' | 'file';
  content: string;        // text body OR absolute local file path
  filename: string | null;
  scheduledDate: string | null;  // 'MM/dd' or null
  createdAt: string;      // ISO 8601
}
