import { establishMailbox } from './establish-mailbox.js';
import { mail } from './mail.js';
import { inspect } from './inspect.js';
import { expeditedDelivery } from './expedited-delivery.js';
import type { Command } from './types.js';

export const commands: Command[] = [establishMailbox, mail, inspect, expeditedDelivery];
export const commandMap = new Map<string, Command>(commands.map(c => [c.data.name, c]));
