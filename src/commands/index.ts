import { establishMailbox } from './establish-mailbox.js';
import { mail } from './mail.js';
import { inspect } from './inspect.js';
import { publish } from './publish.js';
import type { Command } from './types.js';

export const commands: Command[] = [establishMailbox, mail, inspect, publish];
export const commandMap = new Map<string, Command>(commands.map(c => [c.data.name, c]));
