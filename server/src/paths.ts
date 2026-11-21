import os from 'node:os';
import path from 'node:path';

/** Where bots keep their files on this computer: ~/.krishbot/library/<botId> (the Library tab) and browser profiles. */
const root = path.join(os.homedir(), '.krishbot');

export const libraryRoot = () => path.join(root, 'library');
export const profilesRoot = () => path.join(root, 'profiles');
